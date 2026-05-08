/**
 * Threshold engine — recovery_flap_window_seconds.
 *
 * Suprime recovery quando valor oscila na borda. Se 2+ transitions
 * aconteceram nos últimos N segundos, recovery vira "supressed_flap"
 * (state atualizado mas sem alert event de info).
 *
 * Worker code (profile_evaluator.py:910-927):
 *   COUNT(*) FROM iot_alert_events WHERE source='threshold_profile'
 *     AND profile_id=:pid AND sensor_id=:sid AND triggered_at > now() - flap_window
 *   IF count >= 2 → skip recovery event
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS } from '../helpers/iot-context';
import {
  createThresholdProfile,
  bindProfileToSensor,
  ingestReading,
  waitForAlertEventBySensor,
  clearAlertEvents,
  cleanupThreshold,
  getSensorTypeId,
} from './threshold-helpers';

test.describe('Threshold — recovery flap window', () => {
  let sensorId: string;
  let profileId: string;

  test.beforeAll(async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    sensorId = (
      await ensureSensor({
        external_id: 'E2E_TEMP_FLAP',
        sensor_type_name: 'Temperatura',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;
    profileId = (
      await createThresholdProfile({
        sensor_type_id: tempTypeId,
        name: 'E2E Temp Flap',
        thresholds: { warning: { min: 30, max: 40 } },
        cooldown_seconds: 0,
        recovery_enabled: true,
        recovery_flap_window_seconds: 60,
      })
    ).id;
    await bindProfileToSensor(profileId, sensorId);
  });

  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. Múltiplas transitions na janela suprimem recovery flap', async () => {
    // 3 oscilações warning ↔ normal em <60s → recovery event suprimido
    await clearAlertEvents(sensorId);

    // Trigger 1: warning
    await ingestReading(sensorId, 45);
    await waitForAlertEventBySensor(sensorId, 'warning', { timeout_ms: 8000 });

    // Recovery 1: cria info (1ª transition)
    await ingestReading(sensorId, 35);
    await new Promise((r) => setTimeout(r, 2000));

    // Trigger 2: warning de novo
    await ingestReading(sensorId, 45);
    await new Promise((r) => setTimeout(r, 2000));

    // Recovery 2: deveria criar info... mas flap_window detecta 2+ events
    // recentes → suprime. Verifica logs ou state — não cria novo info event.
    const before = new Date();
    await ingestReading(sensorId, 35);

    // Aguarda 5s. Se flap suppress funciona, NÃO chega info novo após 'before'.
    let suppressed = false;
    try {
      await waitForAlertEventBySensor(sensorId, 'info', {
        since: before,
        timeout_ms: 5000,
      });
      suppressed = false;
    } catch {
      suppressed = true;
    }
    expect(suppressed).toBe(true);
  });
});
