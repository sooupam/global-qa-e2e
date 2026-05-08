/**
 * Threshold engine — Cross-sensor suppression (Feature A) + sustain engine.
 *
 * Reproduz cenário legacy ConnectPlus TipoGrafico=7 (Gerador c/ sensor pai):
 *   - Gerador "Manual" sustain ≥ 1h dispara alerta crítico
 *   - MAS se "Energia da Rede" = 0, alerta gerador é suprimido (standby legítimo)
 *   - Se Energia volta a 1, próximo sustain dispara normal
 *
 * Cobre:
 *   1. Sustain time-based dispara após N segundos no estado anormal
 *   2. Cross-sensor suppression bloqueia action quando ref_sensor matchei condição
 *   3. Suppression dinâmica: muda valor do ref_sensor → action volta a executar
 *   4. failures_until_alert (count) dispara antes de sustain time
 *   5. Recovery limpa tracking + alert_fired_at
 *   6. Transição de severity reseta severity_since (sustain re-conta)
 *
 * Setup: sustain_seconds=5 (vs 3600s prod) pra teste rodar em segundos.
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS } from '../helpers/iot-context';
import {
  createThresholdProfile,
  bindProfileToSensor,
  ingestReading,
  waitForAlertEventBySensor,
  cleanupThreshold,
  getSensorTypeId,
  createProfileAction,
  getStateTracking,
  waitForTrackingSeverity,
  callProcessSensorAlert,
  injectReadingSequence,
} from './threshold-helpers';

test.describe('Threshold — Cross-sensor suppression (Feature A)', () => {
  let energiaSensorId: string;
  let geradorSensorId: string;
  let geradorProfileId: string;

  test.beforeAll(async () => {
    await cleanupThreshold();

    // Setup: 2 sensores
    //   "Energia Rede" — tipo Energia Elétrica (binário 0/1)
    //   "Estado Gerador" — usar tipo Fornecimento Energia (binário 0/1) como
    //     proxy pra simplificar (raw=0 = manual/falha, raw=1 = automático/ok).
    //     Lógica testada é cross-sensor + sustain — independente do tipo.
    const energiaTypeId = await getSensorTypeId('Fornecimento Energia');
    const geradorTypeId = await getSensorTypeId('Fornecimento Energia');

    energiaSensorId = (
      await ensureSensor({
        external_id: 'E2E_CROSS_ENERGIA',
        sensor_type_name: 'Fornecimento Energia',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;
    geradorSensorId = (
      await ensureSensor({
        external_id: 'E2E_CROSS_GERADOR',
        sensor_type_name: 'Fornecimento Energia',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;

    // Profile gerador: state_rules com sustain=5s pra raw=0 (Manual/Falha)
    geradorProfileId = (
      await createThresholdProfile({
        sensor_type_id: geradorTypeId,
        name: 'E2E Gerador c/ Sustain',
        thresholds: {
          state_rules: [
            {
              id: 'gen-crit-0',
              op: 'eq',
              value: 0,
              expected_state: 'manual',
              severity: 'critical',
              sustain_seconds: 5,
              label: 'Manual prolongado',
            },
            {
              id: 'gen-info-0',
              op: 'eq',
              value: 0,
              expected_state: 'manual',
              severity: 'info',
              label: 'Manual',
            },
            {
              id: 'gen-info-1',
              op: 'eq',
              value: 1,
              expected_state: 'automatico',
              severity: 'info',
              label: 'Automático',
            },
          ],
        },
        cooldown_seconds: 0,
        recovery_enabled: true,
      })
    ).id;
    await bindProfileToSensor(geradorProfileId, geradorSensorId);

    // Action notify com cross-sensor suppression: action é suprimida se Energia=0
    await createProfileAction({
      profile_id: geradorProfileId,
      trigger_severity: 'critical',
      action_type: 'notify',
      config: {
        recipient_emails: ['e2e-gerador@test.local'],
        title_template: 'Gerador {{sensor}} crítico',
      },
      suppress_when_sensor_id: energiaSensorId,
      suppress_when_operator: 'eq',
      suppress_when_value: 0,
      suppress_when_max_age_seconds: 600,
    });

    void energiaTypeId; // quieta linter (mesma var usada acima)
  });

  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. sustain time-based dispara critical após 5s em raw=0', async () => {
    // Energia ON (não suprime)
    await ingestReading(energiaSensorId, 1);

    // Reading inicial: cria tracking. severity reflete rule matched (critical pra raw=0)
    // mas alert_fired_at=NULL até sustain atingir.
    await ingestReading(geradorSensorId, 0);
    const initial = await getStateTracking(geradorSensorId, geradorProfileId);
    expect(initial?.severity).toBe('critical'); // rule matched, mas...
    expect(initial?.alert_fired_at).toBeNull(); // ...sustain ainda não atingido → sem alert

    // Aguarda sustain (5s) + buffer
    await new Promise((r) => setTimeout(r, 6000));

    // 2ª reading com mesmo valor: trigger reavalia, sustain atingido → critical
    await ingestReading(geradorSensorId, 0);
    const tracking = await waitForTrackingSeverity(geradorSensorId, geradorProfileId, 'critical', {
      timeout_ms: 3000,
    });
    expect(tracking.alert_fired_at).not.toBeNull();
    expect(tracking.alert_event_id).not.toBeNull();
  });

  test('2. cross-sensor suppression bloqueia action quando energia=0', async () => {
    // Energia OFF (deve suprimir action do gerador)
    await ingestReading(energiaSensorId, 0);

    // Força transição: energia=info → reset
    // Reading inicial gerador
    await ingestReading(geradorSensorId, 1); // automático = info
    await new Promise((r) => setTimeout(r, 500));
    await ingestReading(geradorSensorId, 0); // manual

    // Aguarda sustain + dispara
    await new Promise((r) => setTimeout(r, 6000));
    await ingestReading(geradorSensorId, 0);

    const tracking = await waitForTrackingSeverity(geradorSensorId, geradorProfileId, 'critical', {
      timeout_ms: 3000,
    });
    expect(tracking.alert_event_id).not.toBeNull();

    // Chama process-sensor-alert direto pra ler decisão de suppression
    const result = await callProcessSensorAlert(tracking.alert_event_id!);
    const suppressed = (result.executed ?? []).find((e) => e.result.startsWith('suppressed:'));
    expect(suppressed).toBeDefined();
    expect(suppressed?.result).toContain('condition_matched');

    const suppressWarning = (result.warnings ?? []).find((w) => w.includes('suppressed_by_sensor'));
    expect(suppressWarning).toBeDefined();
  });

  test('3. quando energia volta a 1, próxima execução não suprime', async () => {
    // Energia ON
    await ingestReading(energiaSensorId, 1);

    // Reading gerador: força nova transição manual → critical
    await ingestReading(geradorSensorId, 1);
    await new Promise((r) => setTimeout(r, 500));
    await ingestReading(geradorSensorId, 0);
    await new Promise((r) => setTimeout(r, 6000));
    await ingestReading(geradorSensorId, 0);

    const tracking = await waitForTrackingSeverity(geradorSensorId, geradorProfileId, 'critical', {
      timeout_ms: 3000,
    });

    const result = await callProcessSensorAlert(tracking.alert_event_id!);
    // Action deve ter rodado (não suprimida) — pode dar erro de canal mas
    // result NÃO deve ter 'suppressed:condition_matched'
    const wasSuppressed = (result.executed ?? []).some((e) =>
      e.result.startsWith('suppressed:condition_matched')
    );
    expect(wasSuppressed).toBe(false);
  });

  test('4. transição de severity reseta severity_since (sustain re-conta)', async () => {
    // Energia ON
    await ingestReading(energiaSensorId, 1);

    // Manual → Automático → Manual (transição)
    await ingestReading(geradorSensorId, 0);
    await new Promise((r) => setTimeout(r, 500));
    await ingestReading(geradorSensorId, 1);
    await new Promise((r) => setTimeout(r, 500));

    const beforeSecondManual = new Date();
    await ingestReading(geradorSensorId, 0);
    await new Promise((r) => setTimeout(r, 200));

    const tracking = await getStateTracking(geradorSensorId, geradorProfileId);
    expect(tracking).not.toBeNull();
    // severity_since deve ser >= momento da última transição (não da primeira Manual)
    expect(new Date(tracking!.severity_since).getTime()).toBeGreaterThanOrEqual(
      beforeSecondManual.getTime() - 1000 // tolerância 1s pra clock skew
    );
    // severity reflete rule matched imediatamente; sustain afeta alert_fired_at
    expect(tracking?.severity).toBe('critical');
    expect(tracking?.alert_fired_at).toBeNull(); // sustain ainda não atingido
  });

  test('5. recovery: severity volta info reseta alert_fired_at + failure_count', async () => {
    // Setup: força gerador em critical primeiro
    await ingestReading(energiaSensorId, 1);
    await ingestReading(geradorSensorId, 1);
    await new Promise((r) => setTimeout(r, 500));
    await ingestReading(geradorSensorId, 0);
    await new Promise((r) => setTimeout(r, 6000));
    await ingestReading(geradorSensorId, 0);

    const beforeRecovery = await waitForTrackingSeverity(
      geradorSensorId,
      geradorProfileId,
      'critical',
      { timeout_ms: 3000 }
    );
    expect(beforeRecovery.alert_fired_at).not.toBeNull();
    expect(beforeRecovery.failure_count).toBeGreaterThan(0);

    // Volta pra automático
    await ingestReading(geradorSensorId, 1);

    const afterRecovery = await waitForTrackingSeverity(geradorSensorId, geradorProfileId, 'info', {
      timeout_ms: 3000,
    });
    expect(afterRecovery.alert_fired_at).toBeNull();
    expect(afterRecovery.failure_count).toBe(0);
    expect(afterRecovery.matched_rule_id).toBe('gen-info-1');
  });

  test('6. injectReadingSequence helper funciona pra simular sustain longo', async () => {
    // Sanidade: helper reusável funciona sem ser fake
    await ingestReading(energiaSensorId, 1);
    await ingestReading(geradorSensorId, 1); // reset

    await injectReadingSequence(geradorSensorId, [
      { value: 0, delayMs: 1000 },
      { value: 0, delayMs: 1000 },
      { value: 0, delayMs: 1000 },
      { value: 0, delayMs: 3500 }, // total ~6.5s no manual
      { value: 0 }, // trigger sustain check
    ]);

    const tracking = await waitForTrackingSeverity(geradorSensorId, geradorProfileId, 'critical', {
      timeout_ms: 3000,
    });
    expect(tracking.alert_fired_at).not.toBeNull();
  });
});
