/**
 * Helpers Phase 4 — Threshold Engine.
 *
 * Pipeline:
 *   1. createThresholdProfile + bindToSensor
 *   2. ingestReading (INSERT direto em iot_sensor_readings)
 *   3. trigger fn_enqueue_profile_evaluation → pgmq queue
 *   4. profile_evaluator worker consome → INSERT iot_alert_events
 *   5. waitForAlertEventBySensor — polla DB
 */

import { randomUUID } from 'node:crypto';
import { E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function pgRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
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

export interface ThresholdProfileOpts {
  sensor_type_id: string;
  name?: string;
  thresholds: Record<string, unknown>;
  cooldown_seconds?: number;
  recovery_enabled?: boolean;
  recovery_flap_window_seconds?: number;
  evaluation_window_seconds?: number;
  category?: string;
  company_id?: string;
}

export async function createThresholdProfile(opts: ThresholdProfileOpts): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profiles', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id: opts.company_id ?? E2E_COMPANIES.A,
      sensor_type_id: opts.sensor_type_id,
      name: opts.name ?? `E2E Profile ${id.slice(0, 8)}`,
      thresholds: opts.thresholds,
      cooldown_seconds: opts.cooldown_seconds ?? 0,
      recovery_enabled: opts.recovery_enabled ?? true,
      recovery_flap_window_seconds: opts.recovery_flap_window_seconds ?? 5,
      evaluation_window_seconds: opts.evaluation_window_seconds ?? 60,
      correlation_combine_logic: 'AND',
      category: opts.category ?? 'processo',
      is_active: true,
    },
  ]);
  return { id };
}

export async function bindProfileToSensor(
  profile_id: string,
  sensor_id: string,
  company_id: string = E2E_COMPANIES.A
): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profile_bindings', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id,
      profile_id,
      binding_type: 'sensor',
      sensor_id,
      is_active: true,
    },
  ]);
  return { id };
}

export async function bindProfileToSensorType(
  profile_id: string,
  sensor_type_id: string,
  company_id: string = E2E_COMPANIES.A
): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profile_bindings', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id,
      profile_id,
      binding_type: 'sensor_type',
      sensor_type_id,
      is_active: true,
    },
  ]);
  return { id };
}

export async function ingestReading(sensor_id: string, value: number, time?: Date): Promise<void> {
  const t = time ?? new Date();
  await pgRequest('POST', '/iot_sensor_readings', [
    {
      sensor_id,
      tenant_id: E2E_TENANT_ID,
      value,
      time: t.toISOString(),
    },
  ]);
  // Worker correlation evaluation lê iot_sensors.last_value/last_reading_at.
  // Trigger trg_update_sensor_last_reading só atualiza last_reading_at.
  // Forçar update last_value pra worker conseguir avaliar correlations.
  await pgRequest('PATCH', `/iot_sensors?id=eq.${sensor_id}`, {
    last_value: value,
    last_reading_at: t.toISOString(),
  });
}

export interface AlertEvent {
  id: string;
  severity: string;
  status: string;
  trigger_value: number | null;
  triggered_at: string;
  duration_seconds: number | null;
}

/**
 * Polla iot_alert_events filtrado por sensor_id + severity.
 * Retorna primeiro event que bater predicate.
 */
export async function waitForAlertEventBySensor(
  sensor_id: string,
  severity: 'warning' | 'critical' | 'info' | 'normal',
  opts: { since?: Date; timeout_ms?: number; poll_ms?: number } = {}
): Promise<AlertEvent> {
  const timeout = opts.timeout_ms ?? 10000;
  const poll = opts.poll_ms ?? 500;
  const since = opts.since ?? new Date(Date.now() - 5_000);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const rows = (await pgRequest(
      'GET',
      `/iot_alert_events?sensor_id=eq.${sensor_id}&severity=eq.${severity}&triggered_at=gt.${since.toISOString()}&order=triggered_at.desc&limit=1`
    )) as AlertEvent[];
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error(
    `waitForAlertEventBySensor timeout: sensor=${sensor_id} severity=${severity} after ${timeout}ms`
  );
}

/** Limpa alert events do sensor (cleanup entre specs). */
export async function clearAlertEvents(sensor_id: string): Promise<void> {
  await pgRequest('DELETE', `/iot_alert_events?sensor_id=eq.${sensor_id}`);
}

/** Cleanup completo: remove profiles, bindings, alert_events do tenant E2E. */
export async function cleanupThreshold(): Promise<void> {
  // Order matters: actions → bindings → events → profile_state → state_tracking → profiles
  await pgRequest('DELETE', `/iot_threshold_profile_actions?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_threshold_profile_bindings?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_alert_events?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_profile_sensor_state?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_sensor_state_tracking?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_threshold_profiles?tenant_id=eq.${E2E_TENANT_ID}`);
}

/** Cria correlation group + retorna id. */
export async function createCorrelationGroup(
  profile_id: string,
  logic: 'AND' | 'OR',
  parent_id: string | null = null,
  company_id: string = E2E_COMPANIES.A
): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profile_correlations', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id,
      profile_id,
      parent_id,
      logic,
      order_index: 0,
    },
  ]);
  return { id };
}

export interface CorrelationConditionOpts {
  correlation_id: string;
  target_type: 'sensor' | 'sensor_type';
  sensor_id?: string;
  sensor_type_id?: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'between' | 'outside';
  value_primary: number;
  value_secondary?: number;
  sustain_seconds?: number;
  company_id?: string;
}

export async function createCorrelationCondition(
  opts: CorrelationConditionOpts
): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profile_correlation_conditions', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id: opts.company_id ?? E2E_COMPANIES.A,
      correlation_id: opts.correlation_id,
      target_type: opts.target_type,
      sensor_id: opts.sensor_id ?? null,
      sensor_type_id: opts.sensor_type_id ?? null,
      operator: opts.operator,
      value_primary: opts.value_primary,
      value_secondary: opts.value_secondary ?? null,
      sustain_seconds: opts.sustain_seconds ?? 0,
      order_index: 0,
    },
  ]);
  return { id };
}

export async function bindProfileToLocation(
  profile_id: string,
  location_id: string,
  company_id: string = E2E_COMPANIES.A
): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profile_bindings', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id,
      profile_id,
      binding_type: 'location',
      location_id,
      is_active: true,
    },
  ]);
  return { id };
}

/** Pega sensor_type_id por nome. */
export async function getSensorTypeId(name: string): Promise<string> {
  const rows = (await pgRequest(
    'GET',
    `/iot_sensor_types?name=eq.${encodeURIComponent(name)}&limit=1`
  )) as { id: string }[];
  if (rows.length === 0) throw new Error(`sensor_type '${name}' not found`);
  return rows[0].id;
}

// ============================================================
// Helpers para Cross-Sensor Suppression (Feature A) e Sustain Engine
// ============================================================

export interface ProfileActionOpts {
  profile_id: string;
  trigger_severity: 'warning' | 'critical' | 'recovery';
  action_type?: 'notify' | 'webhook' | 'create_wo' | 'escalate' | 'set_status' | 'silence';
  config?: Record<string, unknown>;
  order_index?: number;
  suppress_when_sensor_id?: string;
  suppress_when_operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
  suppress_when_value?: number;
  suppress_when_value2?: number;
  suppress_when_max_age_seconds?: number;
  company_id?: string;
}

/** Cria iot_threshold_profile_actions row, opcionalmente com cross-sensor suppression. */
export async function createProfileAction(opts: ProfileActionOpts): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profile_actions', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id: opts.company_id ?? E2E_COMPANIES.A,
      profile_id: opts.profile_id,
      trigger_severity: opts.trigger_severity,
      action_type: opts.action_type ?? 'notify',
      config: opts.config ?? { recipient_emails: ['e2e@test.local'] },
      order_index: opts.order_index ?? 0,
      is_active: true,
      suppress_when_sensor_id: opts.suppress_when_sensor_id ?? null,
      suppress_when_operator: opts.suppress_when_operator ?? null,
      suppress_when_value: opts.suppress_when_value ?? null,
      suppress_when_value2: opts.suppress_when_value2 ?? null,
      suppress_when_max_age_seconds: opts.suppress_when_max_age_seconds ?? 600,
    },
  ]);
  return { id };
}

export interface StateTrackingRow {
  sensor_id: string;
  profile_id: string;
  severity: 'info' | 'warning' | 'critical' | 'normal';
  severity_since: string;
  matched_rule_id: string | null;
  last_reading_value: number | null;
  last_reading_at: string | null;
  alert_fired_at: string | null;
  alert_event_id: string | null;
  failure_count: number;
}

/** Lê row de iot_sensor_state_tracking. NULL se não existe. */
export async function getStateTracking(
  sensor_id: string,
  profile_id: string
): Promise<StateTrackingRow | null> {
  const rows = (await pgRequest(
    'GET',
    `/iot_sensor_state_tracking?sensor_id=eq.${sensor_id}&profile_id=eq.${profile_id}&limit=1`
  )) as StateTrackingRow[];
  return rows[0] ?? null;
}

/** Polla state_tracking até severity bater. Throw em timeout. */
export async function waitForTrackingSeverity(
  sensor_id: string,
  profile_id: string,
  severity: StateTrackingRow['severity'],
  opts: { timeout_ms?: number; poll_ms?: number } = {}
): Promise<StateTrackingRow> {
  const timeout = opts.timeout_ms ?? 10000;
  const poll = opts.poll_ms ?? 200;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const row = await getStateTracking(sensor_id, profile_id);
    if (row && row.severity === severity) return row;
    await new Promise((r) => setTimeout(r, poll));
  }
  throw new Error(
    `waitForTrackingSeverity timeout: sensor=${sensor_id} profile=${profile_id} severity=${severity}`
  );
}

export interface ProcessSensorAlertResponse {
  skipped?: string;
  alert_event_id?: string;
  error?: string;
  // Threshold profile branch
  executed?: Array<{ id: string; action_type: string; result: string }>;
  warnings?: string[];
}

/**
 * Chama edge function process-sensor-alert direto via HTTP, retorna JSON.
 * Útil pra inspecionar suppression decision nos warnings/executed.
 *
 * Edge fn exige X-Company-Id header quando chamado com service_role —
 * resolve company_id do alert_event automaticamente se não passado.
 */
export async function callProcessSensorAlert(
  alert_event_id: string,
  company_id?: string
): Promise<ProcessSensorAlertResponse> {
  let cid = company_id;
  if (!cid) {
    const rows = (await pgRequest(
      'GET',
      `/iot_alert_events?id=eq.${alert_event_id}&select=company_id&limit=1`
    )) as Array<{ company_id: string }>;
    cid = rows[0]?.company_id ?? E2E_COMPANIES.A;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-sensor-alert`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': 'application/json',
      'X-Company-Id': cid,
    },
    body: JSON.stringify({ alert_event_id }),
  });
  if (!res.ok) {
    throw new Error(`process-sensor-alert ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<ProcessSensorAlertResponse>;
}

/**
 * Ingest múltiplas readings em sequência com delay entre elas.
 * Útil pra simular sustain time-based ou failures count-based.
 */
export async function injectReadingSequence(
  sensor_id: string,
  values: Array<{ value: number; delayMs?: number }>
): Promise<void> {
  for (const v of values) {
    await ingestReading(sensor_id, v.value);
    if (v.delayMs && v.delayMs > 0) {
      await new Promise((r) => setTimeout(r, v.delayMs));
    }
  }
}
