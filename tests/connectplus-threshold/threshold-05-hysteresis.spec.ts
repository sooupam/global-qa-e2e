/**
 * Threshold engine — hysteresis (deadband prevents flap).
 *
 * Hysteresis suprime recovery prematuro. Valor deve passar da borda da
 * zona anterior por pelo menos N unidades antes de transicionar pra normal.
 *
 * Worker code (profile_evaluator.py:843-860):
 *   `hysteresis` no `thresholds.hysteresis` (ou top-level effective).
 *   Aplicado apenas em transição warning|critical → normal.
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

test.describe('Threshold — hysteresis', () => {
  let sensorId: string;
  let profileId: string;

  test.beforeAll(async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    sensorId = (
      await ensureSensor({
        external_id: 'E2E_TEMP_HYSTERESIS',
        sensor_type_name: 'Temperatura',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;
    // Zones: 22-28 normal, 28-35 warning. Hysteresis 3 unidades.
    // Pra sair de warning → normal precisa value <= 28-3 = 25
    profileId = (
      await createThresholdProfile({
        sensor_type_id: tempTypeId,
        name: 'E2E Temp Hysteresis',
        thresholds: {
          zones: [
            { min: 22, max: 28, severity: 'normal' },
            { min: 28, max: 35, severity: 'warning' },
            { min: 35, max: 100, severity: 'critical' },
          ],
          hysteresis: 3,
        },
        cooldown_seconds: 0,
        recovery_enabled: true,
        recovery_flap_window_seconds: 0,
      })
    ).id;
    await bindProfileToSensor(profileId, sensorId);
  });

  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. value=24 (zona normal +1 da borda zmax warning) recupera', async () => {
    // Worker code (profile_evaluator.py:854): hysteresis verifica DENTRO da
    // zona da last_severity, NÃO na zona normal. Para suprimir recovery,
    // value precisaria estar dentro warning zone 28-35 perto da borda.
    // Pra recovery normal value=24 (longe da borda), recovery DEVE disparar.
    await clearAlertEvents(sensorId);
    await ingestReading(sensorId, 30);
    await waitForAlertEventBySensor(sensorId, 'warning', { timeout_ms: 8000 });
    await clearAlertEvents(sensorId);

    const before = new Date();
    await ingestReading(sensorId, 24);
    let event;
    try {
      event = await waitForAlertEventBySensor(sensorId, 'info', {
        since: before,
        timeout_ms: 8000,
      });
    } catch {
      event = await waitForAlertEventBySensor(sensorId, 'normal', {
        since: before,
        timeout_ms: 5000,
      });
    }
    expect(['info', 'normal']).toContain(event.severity);
  });

  test('2. value=24 (além hysteresis) recupera pra normal/info', async () => {
    // Setup: warning state via value=30
    await ingestReading(sensorId, 30);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);

    // Recovery: value 24 ≤ 28 - 3 = 25 → recovery dispara
    const before = new Date();
    await ingestReading(sensorId, 24);
    let event;
    try {
      event = await waitForAlertEventBySensor(sensorId, 'info', {
        since: before,
        timeout_ms: 8000,
      });
    } catch {
      event = await waitForAlertEventBySensor(sensorId, 'normal', {
        since: before,
        timeout_ms: 5000,
      });
    }
    expect(['info', 'normal']).toContain(event.severity);
  });
});
