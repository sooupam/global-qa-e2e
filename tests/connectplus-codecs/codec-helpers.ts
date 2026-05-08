/**
 * Helpers compartilhados pra suite Phase 3 — Codec Matrix.
 *
 * Padrão dos specs:
 *   1. Garantir que sensor de baseline existe com external_id determinístico
 *   2. clearReadings(sensor_id) pra estado limpo
 *   3. publishMqtt(topic, payload) — broker test:11883
 *   4. Bridge runner consome → codec parseia → INSERT iot_sensor_readings
 *   5. waitForReading(sensor_id, predicate) — polla DB
 *   6. Asserta value + sensor_type + metadata
 *
 * NÃO testa lógica de profile/alert (Phase 4). Foca exclusivamente em
 * dispatch + parsing per codec/path/device.
 */

import { expect } from '@playwright/test';
import {
  E2E_TENANT_ID,
  E2E_COMPANIES,
  E2E_GATEWAYS,
  publishMqtt,
  waitForReading,
  clearReadings,
} from '../helpers/iot-context';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Topics dos bridges baseline (alinhados ao seed). */
export const BRIDGE_TOPICS = {
  khompMulti: 'e2e/khomp/A',
  khompModbus: 'e2e/khomp/modbus',
  minew: 'e2e/minew/A',
  jsonGeneric: 'e2e/json/A',
  raw: 'e2e/raw/A',
} as const;

async function pgRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Cria sensor com external_id determinístico (ou retorna existente). */
export async function ensureSensor(opts: {
  external_id: string;
  sensor_type_name: string;
  gateway_id?: string;
  company_id?: string;
}): Promise<{ id: string }> {
  // Lookup
  const existing = (await pgRequest(
    'GET',
    `/iot_sensors?tenant_id=eq.${E2E_TENANT_ID}&external_id=eq.${encodeURIComponent(opts.external_id)}`
  )) as { id: string }[];
  if (existing.length > 0) return { id: existing[0].id };

  // Resolve sensor_type_id
  const types = (await pgRequest(
    'GET',
    `/iot_sensor_types?name=eq.${encodeURIComponent(opts.sensor_type_name)}&limit=1`
  )) as { id: string }[];
  if (types.length === 0) {
    throw new Error(`sensor_type '${opts.sensor_type_name}' not found in catalog`);
  }

  const id = crypto.randomUUID();
  await pgRequest('POST', '/iot_sensors', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id: opts.company_id ?? E2E_COMPANIES.A,
      gateway_id: opts.gateway_id ?? E2E_GATEWAYS.khompV2,
      sensor_type_id: types[0].id,
      name: `E2E Codec ${opts.external_id}`,
      external_id: opts.external_id,
      status: 'active',
      owner_type: 'company',
      is_active: true,
    },
  ]);
  return { id };
}

/**
 * Publica payload + aguarda reading aparecer pro sensor_id alvo.
 * Falha se reading não chegar em timeout_ms (default 8s).
 */
export async function publishAndWait(opts: {
  topic: string;
  payload: object | string;
  sensor_id: string;
  expected_value?: number;
  timeout_ms?: number;
}): Promise<{ time: string; value: number | null }> {
  await clearReadings(opts.sensor_id);
  await publishMqtt({ topic: opts.topic, payload: opts.payload, qos: 1 });
  const reading = await waitForReading(
    opts.sensor_id,
    (r) => (opts.expected_value !== undefined ? r.value === opts.expected_value : r.value !== null),
    { timeout_ms: opts.timeout_ms ?? 8000 }
  );
  return reading;
}

/** Asserta reading recente bate value (com tolerance pra float). */
export function expectValueClose(
  reading: { value: number | null },
  target: number,
  tolerance = 0.01
): void {
  expect(reading.value).not.toBeNull();
  expect(Math.abs((reading.value as number) - target)).toBeLessThan(tolerance);
}
