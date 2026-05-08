/**
 * IoTTestContext — fixture pra suite E2E ConnectPlus.
 *
 * Helpers (Phase 1 baseline):
 *   • Conexão direta com Postgres do Supabase (raw SQL, bypassa RLS via service_role)
 *   • Factories pra cadastro programático: bridge, gateway, sensor, virtual sensor,
 *     threshold profile, automation flow
 *   • Wait helpers: waitForReading, waitForAlertEvent
 *   • MQTT publisher: publica payload no broker test (port 11883) e aguarda ack
 *   • Cleanup: TRUNCATE + DELETE filtrado por tenant_id E2E
 *
 * Ver docs/plans/2026-04-28-connectplus-e2e-quality-gate.md
 *
 * IMPORTANTE: nunca tocar tenant_id != E2E_TENANT_ID (defesa em camadas).
 * IMPORTANTE: cleanup() em afterEach/afterAll pra evitar vazamento entre specs.
 */

import { randomUUID } from 'node:crypto';
import { connect as mqttConnect, type MqttClient, type IClientOptions } from 'mqtt';

// ─────────────────────────────────────────────────────────────────────────
// Constantes determinísticas (alinhadas ao seed iot_e2e_baseline.sql)
// ─────────────────────────────────────────────────────────────────────────

export const E2E_TENANT_ID = '11111111-1111-4111-8111-111111111111';
export const E2E_TENANT_SLUG = 'e2e-test';

export const E2E_COMPANIES = {
  A: '22222222-2222-4222-8222-222222222221',
  B: '22222222-2222-4222-8222-222222222222',
  C: '22222222-2222-4222-8222-222222222223',
} as const;

export const E2E_BRIDGES = {
  khompMulti: '33333333-3333-4333-8333-333333333301',
  khompModbus: '33333333-3333-4333-8333-333333333302',
  minew: '33333333-3333-4333-8333-333333333303',
  jsonGeneric: '33333333-3333-4333-8333-333333333304',
  raw: '33333333-3333-4333-8333-333333333305',
  milesight: '33333333-3333-4333-8333-333333333306',
} as const;

export const E2E_GATEWAYS = {
  khompV2: '44444444-4444-4444-8444-444444444401',
  khompV3: '44444444-4444-4444-8444-444444444402',
  khompKfm: '44444444-4444-4444-8444-444444444403',
  minewG1: '44444444-4444-4444-8444-444444444404',
  minewMg3: '44444444-4444-4444-8444-444444444405',
  minewMg4: '44444444-4444-4444-8444-444444444406',
  minewMg6: '44444444-4444-4444-8444-444444444407',
} as const;

export const E2E_SENSORS = {
  temp: '55555555-5555-4555-8555-555555555501',
  pressure: '55555555-5555-4555-8555-555555555502',
  current: '55555555-5555-4555-8555-555555555503',
  power: '55555555-5555-4555-8555-555555555504',
  voltage: '55555555-5555-4555-8555-555555555505',
} as const;

const TEST_MQTT_HOST = process.env.E2E_MQTT_HOST || 'localhost';
const TEST_MQTT_PORT = Number(process.env.E2E_MQTT_PORT || 11883);
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// ─────────────────────────────────────────────────────────────────────────
// Postgres helper — REST PostgREST com service_role (bypassa RLS)
// ─────────────────────────────────────────────────────────────────────────
// Não usamos pg client direto (driver nativo node-postgres não está em deps).
// PostgREST cobre INSERT/SELECT/DELETE com mesma performance pra E2E.

async function pgRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostgREST ${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────

export interface CreateBridgeOpts {
  name?: string;
  parser_type?: string;
  topic?: string;
  company_id?: string;
  parser_config?: Record<string, unknown>;
}

export async function createBridge(opts: CreateBridgeOpts = {}): Promise<{ id: string }> {
  const id = randomUUID();
  const row = {
    id,
    tenant_id: E2E_TENANT_ID,
    company_id: opts.company_id ?? E2E_COMPANIES.A,
    name: opts.name ?? `E2E Bridge ${id.slice(0, 8)}`,
    broker_host: TEST_MQTT_HOST === 'localhost' ? 'test-mqtt' : TEST_MQTT_HOST,
    broker_port: 1883,
    topic: opts.topic ?? `e2e/test/${id.slice(0, 8)}`,
    parser_type: opts.parser_type ?? 'json_generic',
    parser_config: opts.parser_config ?? {},
    sensor_mapping_mode: 'auto',
    auto_discovery: false,
    is_active: false,
    status: 'disconnected',
    qos: 0,
    use_tls: false,
  };
  await pgRequest('POST', '/iot_mqtt_bridges', [row]);
  return { id };
}

export interface CreateGatewayOpts {
  name?: string;
  gateway_model_id?: string;
  company_id?: string;
}

export async function createGateway(opts: CreateGatewayOpts = {}): Promise<{ id: string }> {
  const id = randomUUID();
  const row = {
    id,
    tenant_id: E2E_TENANT_ID,
    company_id: opts.company_id ?? E2E_COMPANIES.A,
    name: opts.name ?? `E2E Gateway ${id.slice(0, 8)}`,
    gateway_model_id: opts.gateway_model_id ?? null,
    status: 'online',
    is_active: true,
    owner_type: 'company',
  };
  await pgRequest('POST', '/iot_gateways', [row]);
  return { id };
}

export interface CreateSensorOpts {
  name?: string;
  sensor_type_id: string;
  external_id?: string;
  gateway_id?: string;
  company_id?: string;
}

export async function createSensor(opts: CreateSensorOpts): Promise<{ id: string }> {
  const id = randomUUID();
  const row = {
    id,
    tenant_id: E2E_TENANT_ID,
    company_id: opts.company_id ?? E2E_COMPANIES.A,
    gateway_id: opts.gateway_id ?? E2E_GATEWAYS.khompV2,
    sensor_type_id: opts.sensor_type_id,
    name: opts.name ?? `E2E Sensor ${id.slice(0, 8)}`,
    external_id: opts.external_id ?? `E2E_${id.slice(0, 8).toUpperCase()}`,
    status: 'active',
    owner_type: 'company',
    is_active: true,
  };
  await pgRequest('POST', '/iot_sensors', [row]);
  return { id };
}

export interface InjectReadingOpts {
  sensor_id: string;
  value: number;
  severity?: 'normal' | 'warning' | 'critical';
  note?: string;
}

/**
 * Inject reading via Edge Function `inject-sensor-reading`.
 * Bypassa MQTT — usar pra setup de estado, NÃO pra validar codec.
 */
export async function injectReading(opts: InjectReadingOpts): Promise<unknown> {
  const url = `${SUPABASE_URL}/functions/v1/inject-sensor-reading`;
  // Service role calls exigem X-Company-Id header (defense-in-depth tenant isolation).
  // Resolve company_id do sensor antes de chamar EF.
  const sensorRow = (await pgRequest(
    'GET',
    `/iot_sensors?id=eq.${opts.sensor_id}&select=company_id`
  )) as { company_id: string }[];
  if (sensorRow.length === 0) {
    throw new Error(`sensor ${opts.sensor_id} not found for inject`);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'X-Company-Id': sensorRow[0].company_id,
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    throw new Error(`inject-sensor-reading ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────
// MQTT publisher
// ─────────────────────────────────────────────────────────────────────────

export interface MqttPublishOpts {
  topic: string;
  payload: object | string;
  qos?: 0 | 1 | 2;
  timeout_ms?: number;
}

/**
 * Publica payload no broker test e aguarda ack do broker (QoS 1).
 * Reusa client por chamada — não otimizado pra alta vazão (Phase 1 baseline).
 */
export async function publishMqtt(opts: MqttPublishOpts): Promise<void> {
  const clientOpts: IClientOptions = {
    host: TEST_MQTT_HOST,
    port: TEST_MQTT_PORT,
    clientId: `e2e-publisher-${randomUUID().slice(0, 8)}`,
    connectTimeout: 5000,
    reconnectPeriod: 0,
  };
  const client: MqttClient = mqttConnect(clientOpts);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`mqtt connect timeout (${TEST_MQTT_HOST}:${TEST_MQTT_PORT})`)),
        opts.timeout_ms ?? 5000
      );
      client.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      client.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    const message = typeof opts.payload === 'string' ? opts.payload : JSON.stringify(opts.payload);
    await new Promise<void>((resolve, reject) => {
      client.publish(opts.topic, message, { qos: opts.qos ?? 1 }, (err) =>
        err ? reject(err) : resolve()
      );
    });
  } finally {
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Wait helpers (polling DB, evita race com workers async)
// ─────────────────────────────────────────────────────────────────────────

export async function waitForReading(
  sensor_id: string,
  predicate: (row: { time: string; value: number | null }) => boolean,
  opts: { timeout_ms?: number; poll_ms?: number } = {}
): Promise<{ time: string; value: number | null }> {
  const timeout = opts.timeout_ms ?? 15000;
  const poll = opts.poll_ms ?? 500;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const rows = (await pgRequest(
      'GET',
      `/iot_sensor_readings?sensor_id=eq.${sensor_id}&order=time.desc&limit=5`
    )) as { time: string; value: number | null }[];
    const match = rows.find(predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error(`waitForReading timeout: sensor=${sensor_id} after ${timeout}ms`);
}

export async function waitForAlertEvent(
  profile_id: string,
  severity: 'warning' | 'critical' | 'info' | 'normal',
  opts: { timeout_ms?: number; poll_ms?: number } = {}
): Promise<{ id: string; severity: string; triggered_at: string }> {
  const timeout = opts.timeout_ms ?? 15000;
  const poll = opts.poll_ms ?? 500;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const rows = (await pgRequest(
      'GET',
      `/iot_alert_events?profile_id=eq.${profile_id}&severity=eq.${severity}&order=triggered_at.desc&limit=1`
    )) as { id: string; severity: string; triggered_at: string }[];
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error(
    `waitForAlertEvent timeout: profile=${profile_id} severity=${severity} after ${timeout}ms`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cleanup — chamar em afterEach/afterAll pra remover dados criados via factory
// ─────────────────────────────────────────────────────────────────────────

/**
 * Apaga readings, sensors, gateways e bridges criados durante teste,
 * exceto os do baseline (UUIDs fixos do seed). Filtra estritamente por tenant_id E2E.
 */
export async function cleanupDynamic(): Promise<void> {
  const baselineSensors = Object.values(E2E_SENSORS).join(',');
  const baselineBridges = Object.values(E2E_BRIDGES).join(',');
  const baselineGateways = Object.values(E2E_GATEWAYS).join(',');

  // Readings de sensores que NÃO estão no baseline (sensors criados em teste)
  await pgRequest(
    'DELETE',
    `/iot_sensor_readings?tenant_id=eq.${E2E_TENANT_ID}&sensor_id=not.in.(${baselineSensors})`
  );
  // Sensors fora do baseline
  await pgRequest(
    'DELETE',
    `/iot_sensors?tenant_id=eq.${E2E_TENANT_ID}&id=not.in.(${baselineSensors})`
  );
  // Gateways fora do baseline
  await pgRequest(
    'DELETE',
    `/iot_gateways?tenant_id=eq.${E2E_TENANT_ID}&id=not.in.(${baselineGateways})`
  );
  // Bridges fora do baseline
  await pgRequest(
    'DELETE',
    `/iot_mqtt_bridges?tenant_id=eq.${E2E_TENANT_ID}&id=not.in.(${baselineBridges})`
  );
}

/**
 * Wipe COMPLETO — incluindo baseline. Só pra reset total. NÃO usar em afterEach.
 */
export async function cleanupAll(): Promise<void> {
  await pgRequest('DELETE', `/iot_sensor_readings?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_sensors?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_gateways?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_mqtt_bridges?tenant_id=eq.${E2E_TENANT_ID}`);
}

/** Remove readings de um sensor específico (handy entre specs do mesmo sensor). */
export async function clearReadings(sensor_id: string): Promise<void> {
  await pgRequest('DELETE', `/iot_sensor_readings?sensor_id=eq.${sensor_id}`);
}
