/**
 * Smoke spec — valida infra Phase 1.
 *
 * Confirma que:
 *   1. Seed baseline aplicado (tenant, companies, bridges, gateways, sensors)
 *   2. Factories criam + cleanup remove
 *   3. inject-sensor-reading EF roteado
 *   4. waitForReading detecta reading nova
 *   5. Broker MQTT test responde a publish (eclipse-mosquitto:11883)
 *
 * NÃO testa lógica de negócio — só infra. Specs de domínio em phases 2+.
 *
 * Run: SUPABASE_URL=http://localhost:54321 npx playwright test connectplus-smoke
 */

import { test, expect } from '@playwright/test';
import {
  E2E_TENANT_ID,
  E2E_TENANT_SLUG,
  E2E_BRIDGES,
  E2E_GATEWAYS,
  E2E_SENSORS,
  createSensor,
  injectReading,
  waitForReading,
  publishMqtt,
  cleanupDynamic,
  clearReadings,
} from './helpers/iot-context';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function pgGet(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

test.describe('ConnectPlus E2E — Phase 1 smoke', () => {
  test.afterEach(async () => {
    await cleanupDynamic();
  });

  test('seed baseline — tenant, companies, bridges, gateways, sensors presentes', async () => {
    const tenants = await pgGet(`/tenants?id=eq.${E2E_TENANT_ID}`);
    expect(tenants).toHaveLength(1);
    expect((tenants[0] as { slug: string }).slug).toBe(E2E_TENANT_SLUG);

    const companies = await pgGet(`/companies?tenant_id=eq.${E2E_TENANT_ID}`);
    expect(companies.length).toBeGreaterThanOrEqual(3);

    const bridges = await pgGet(`/iot_mqtt_bridges?tenant_id=eq.${E2E_TENANT_ID}`);
    expect(bridges.length).toBeGreaterThanOrEqual(6);

    const gateways = await pgGet(`/iot_gateways?tenant_id=eq.${E2E_TENANT_ID}`);
    expect(gateways.length).toBeGreaterThanOrEqual(7);

    const sensors = await pgGet(`/iot_sensors?tenant_id=eq.${E2E_TENANT_ID}`);
    expect(sensors.length).toBeGreaterThanOrEqual(5);
  });

  test('factory createSensor + cleanup — cria e remove', async () => {
    const sensorTypes = (await pgGet(`/iot_sensor_types?name=eq.Temperatura&limit=1`)) as {
      id: string;
    }[];
    expect(sensorTypes.length).toBe(1);

    const { id } = await createSensor({
      sensor_type_id: sensorTypes[0].id,
      name: 'E2E Smoke Sensor',
      external_id: 'E2E_SMOKE_001',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const after = (await pgGet(`/iot_sensors?id=eq.${id}`)) as { id: string; tenant_id: string }[];
    expect(after).toHaveLength(1);
    expect(after[0].tenant_id).toBe(E2E_TENANT_ID);

    // Cleanup runs in afterEach. Validação acontece na próxima spec ou via test isolado.
  });

  test('PostgREST INSERT iot_sensor_readings + waitForReading — direct path', async () => {
    await clearReadings(E2E_SENSORS.temp);

    const targetValue = 23.5;
    const now = new Date().toISOString();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/iot_sensor_readings`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([
        {
          sensor_id: E2E_SENSORS.temp,
          tenant_id: E2E_TENANT_ID,
          value: targetValue,
          time: now,
        },
      ]),
    });
    expect(res.ok).toBe(true);

    const reading = await waitForReading(E2E_SENSORS.temp, (r) => r.value === targetValue, {
      timeout_ms: 5000,
    });
    expect(reading.value).toBe(targetValue);
  });

  test('injectReading via EF — DNS attached + X-Company-Id header', async () => {
    await clearReadings(E2E_SENSORS.temp);
    await injectReading({ sensor_id: E2E_SENSORS.temp, value: 99.9 });
    const reading = await waitForReading(E2E_SENSORS.temp, (r) => r.value === 99.9);
    expect(reading.value).toBe(99.9);
  });

  test('publishMqtt — broker test (eclipse-mosquitto:11883) aceita publish', async () => {
    // Não verificamos ingest aqui — bridge não está rodando contra broker test.
    // Só confirmamos que client publica sem erro (broker up + reachable).
    await publishMqtt({
      topic: `e2e/smoke/${Date.now()}`,
      payload: { hello: 'world' },
      qos: 1,
      timeout_ms: 5000,
    });
  });
});
