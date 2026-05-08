/**
 * Threshold engine — Validação real Hospital Vila Lobos (HVL) QTA-1..5.
 *
 * Não cria sensores: usa os 5 geradores QTA + sensor "Fornecimento" reais
 * já cadastrados na Quinta D'Or via bootstrap (commit f353ba78 + manual).
 *
 * Cobre:
 *   1. Auto (raw=1) → severity=info, alert_fired_at NULL
 *   2. Manual transição (raw=2) → severity=critical mas alert ainda NULL
 *   3. Manual sustained 30s+ → alert_fired_at SET, action processada
 *   4. Energia=0 → action notify SUPPRESSED
 *   5. Recovery (volta pra Auto) → severity=info, alert_fired_at NULL
 *
 * Pré-requisitos:
 *   - 5 geradores QTA cadastrados (HVL_DEEP_SEA_8660_NEW_5..9_772)
 *   - Profile "Estado Gerador DEEP SEA - Padrão" bound a cada
 *   - Action notify com suppress_when_sensor_id = HVL_ENERGIA_PULSOATIVO
 *   - sustain_seconds=30 no profile (reduzido pra teste)
 */

import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SR_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const COMPANY_QUINTA = '9a6d5922-da83-5a43-a719-77c63c0c1da9';

const SENSORS = {
  energia: '098ef63e-42e0-457a-ac94-07acb596b323',
  qta1: 'dcaa6277-1a6c-4f3d-bcd2-632fe65d84e1',
  qta2: 'e642f1bb-838e-41ce-a51d-db6fe37c6589',
  qta3: '4638698a-d2eb-4f05-a8ea-d1f9bef3dcf2',
  qta4: 'e0b27460-6d2f-451f-8e3d-e1a563aed105',
  qta5: '05d20d0b-d6a5-4116-9824-be45ad239716',
} as const;

async function injectReading(sensor_id: string, value: number): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/inject-sensor-reading`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      apikey: SR_KEY,
      'Content-Type': 'application/json',
      'X-Company-Id': COMPANY_QUINTA,
    },
    body: JSON.stringify({ sensor_id, value }),
  });
  if (!res.ok) throw new Error(`inject-sensor-reading ${res.status}: ${await res.text()}`);
}

async function pgGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { Authorization: `Bearer ${SR_KEY}`, apikey: SR_KEY },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function pgDelete(path: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SR_KEY}`, apikey: SR_KEY, Prefer: 'return=minimal' },
  });
  if (!res.ok && res.status !== 404)
    throw new Error(`DELETE ${path} ${res.status}: ${await res.text()}`);
}

interface TrackingRow {
  sensor_id: string;
  profile_id: string;
  severity: string;
  severity_since: string;
  alert_fired_at: string | null;
  alert_event_id: string | null;
  failure_count: number;
}

async function getTracking(sensor_id: string): Promise<TrackingRow | null> {
  const rows = await pgGet<TrackingRow[]>(
    `/iot_sensor_state_tracking?sensor_id=eq.${sensor_id}&order=severity_since.desc&limit=1`
  );
  return rows[0] ?? null;
}

interface AlertEvent {
  id: string;
  severity: string;
  trigger_value: number | null;
  triggered_at: string;
}

async function getLatestAlert(sensor_id: string): Promise<AlertEvent | null> {
  const rows = await pgGet<AlertEvent[]>(
    `/iot_alert_events?sensor_id=eq.${sensor_id}&order=triggered_at.desc&limit=1`
  );
  return rows[0] ?? null;
}

async function callProcessSensorAlert(alert_event_id: string): Promise<{
  executed?: Array<{ id: string; action_type: string; result: string }>;
  warnings?: string[];
}> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-sensor-alert`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SR_KEY}`,
      apikey: SR_KEY,
      'Content-Type': 'application/json',
      'X-Company-Id': COMPANY_QUINTA,
    },
    body: JSON.stringify({ alert_event_id }),
  });
  if (!res.ok) throw new Error(`process-sensor-alert ${res.status}: ${await res.text()}`);
  return res.json();
}

async function cleanState(sensor_id: string): Promise<void> {
  // Limpa alert_events e tracking pra esse sensor (NÃO limpa profile, action, binding)
  await pgDelete(`/iot_alert_events?sensor_id=eq.${sensor_id}`);
  await pgDelete(`/iot_sensor_state_tracking?sensor_id=eq.${sensor_id}`);
}

// ⚠️ SKIPPED por padrão: roda contra sensores REAIS de produção (Quinta D'Or)
// que recebem leituras live do gateway Khomp a cada ~20s. Worker iot-runtime
// injeta value=1 (Auto) periodicamente, invalidando qualquer simulação de
// sustain (cada minha reading=2 é desfeita pela próxima reading do worker).
//
// Pra rodar manualmente em janela controlada:
//   1. Pausar gateway/worker iot-runtime (docker stop)
//   2. Reduzir sustain pra 30s no profile (ver instruções abaixo)
//   3. test.describe → test.describe.only — OR remover skip()
//   4. Restaurar tudo após
//
// Validação automatizada da arquitetura cross-sensor suppression cobre via
// threshold-15-cross-sensor-suppression.spec.ts (sensores fake, 6/6 passa).
test.describe.skip('HVL — QTA-1..5 cenários reais Quinta DOr (manual only)', () => {
  test.beforeAll(async () => {
    // Estado inicial limpo: limpa tracking + events de todos os 5 QTAs
    for (const id of [SENSORS.qta1, SENSORS.qta2, SENSORS.qta3, SENSORS.qta4, SENSORS.qta5]) {
      await cleanState(id);
    }
    // Energia ON
    await injectReading(SENSORS.energia, 1);
  });

  test('1. QTA-2 auto (raw=1) → severity info, sem alerta', async () => {
    await cleanState(SENSORS.qta2);
    await injectReading(SENSORS.qta2, 1);
    await new Promise((r) => setTimeout(r, 1000));

    const tracking = await getTracking(SENSORS.qta2);
    expect(tracking).not.toBeNull();
    expect(tracking?.severity).toBe('info');
    expect(tracking?.alert_fired_at).toBeNull();

    const alert = await getLatestAlert(SENSORS.qta2);
    expect(alert).toBeNull();
  });

  test('2. QTA-2 manual (raw=2) transição → severity critical, alert NULL ainda', async () => {
    await cleanState(SENSORS.qta2);
    // Reading inicial: cria tracking severity=critical (rule matched) mas sustain=NULL
    await injectReading(SENSORS.qta2, 2);
    await new Promise((r) => setTimeout(r, 1000));

    const tracking = await getTracking(SENSORS.qta2);
    expect(tracking?.severity).toBe('critical');
    expect(tracking?.alert_fired_at).toBeNull();
  });

  test('3. QTA-3 manual sustained 30s+ → alert dispara, action processada (não suprimida)', async () => {
    await cleanState(SENSORS.qta3);
    await injectReading(SENSORS.energia, 1); // Energia ON (não suprime)

    // 1ª reading: cria tracking
    await injectReading(SENSORS.qta3, 2);
    await new Promise((r) => setTimeout(r, 1500));

    const initial = await getTracking(SENSORS.qta3);
    expect(initial?.severity).toBe('critical');
    expect(initial?.alert_fired_at).toBeNull();

    // Aguarda sustain (30s) + buffer
    await new Promise((r) => setTimeout(r, 32_000));

    // 2ª reading: trigger reavalia, sustain atingido
    await injectReading(SENSORS.qta3, 2);
    await new Promise((r) => setTimeout(r, 1500));

    const fired = await getTracking(SENSORS.qta3);
    expect(fired?.alert_fired_at).not.toBeNull();
    expect(fired?.alert_event_id).not.toBeNull();

    // Re-processa action: energia=1 → não suprime
    const result = await callProcessSensorAlert(fired!.alert_event_id!);
    const suppressed = (result.executed ?? []).find((e) =>
      e.result.startsWith('suppressed:condition_matched')
    );
    expect(suppressed).toBeUndefined();
  });

  test('4. QTA-4 manual sustained + energia=0 → action SUPPRESSED', async () => {
    await cleanState(SENSORS.qta4);

    // Energia OFF (vai suprimir)
    await injectReading(SENSORS.energia, 0);
    await new Promise((r) => setTimeout(r, 500));

    // QTA-4 manual
    await injectReading(SENSORS.qta4, 0);
    await new Promise((r) => setTimeout(r, 1500));

    // Aguarda sustain
    await new Promise((r) => setTimeout(r, 32_000));

    // Reavalia
    await injectReading(SENSORS.qta4, 0);
    await new Promise((r) => setTimeout(r, 1500));

    const fired = await getTracking(SENSORS.qta4);
    expect(fired?.alert_fired_at).not.toBeNull();

    const result = await callProcessSensorAlert(fired!.alert_event_id!);
    const suppressed = (result.executed ?? []).find((e) => e.result.startsWith('suppressed:'));
    expect(suppressed).toBeDefined();
    expect(suppressed?.result).toContain('condition_matched');

    const suppressWarning = (result.warnings ?? []).find((w) => w.includes('suppressed_by_sensor'));
    expect(suppressWarning).toBeDefined();
  });

  test('5. QTA-5 recovery — volta pra Auto reseta tracking', async () => {
    await cleanState(SENSORS.qta5);
    await injectReading(SENSORS.energia, 1);

    // Força critical
    await injectReading(SENSORS.qta5, 2);
    await new Promise((r) => setTimeout(r, 32_000));
    await injectReading(SENSORS.qta5, 2);
    await new Promise((r) => setTimeout(r, 1500));

    const beforeRecovery = await getTracking(SENSORS.qta5);
    expect(beforeRecovery?.alert_fired_at).not.toBeNull();
    expect(beforeRecovery?.failure_count).toBeGreaterThan(0);

    // Recovery: volta pra Automático
    await injectReading(SENSORS.qta5, 1);
    await new Promise((r) => setTimeout(r, 1500));

    const afterRecovery = await getTracking(SENSORS.qta5);
    expect(afterRecovery?.severity).toBe('info');
    expect(afterRecovery?.alert_fired_at).toBeNull();
    expect(afterRecovery?.failure_count).toBe(0);
  });

  test('6. Sanity — todos 5 QTAs têm reference_sensor_id apontando pra Fornecimento', async () => {
    interface Sensor {
      id: string;
      name: string;
      reference_sensor_id: string | null;
    }
    const sensors = await pgGet<Sensor[]>(
      `/iot_sensors?id=in.(${[
        SENSORS.qta1,
        SENSORS.qta2,
        SENSORS.qta3,
        SENSORS.qta4,
        SENSORS.qta5,
      ].join(',')})&select=id,name,reference_sensor_id`
    );
    expect(sensors).toHaveLength(5);
    for (const s of sensors) {
      expect(s.reference_sensor_id).toBe(SENSORS.energia);
    }
  });
});
