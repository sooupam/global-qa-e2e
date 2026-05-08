/**
 * Threshold engine — cooldown allow escalation warning→critical.
 *
 * Cooldown bloqueia eventos de severity igual OU menor durante janela.
 * Permite escalonamento (worker code:632-644): warning ativo + critical
 * transition → critical passa (cooldown só bloqueia rank >= new).
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

test.describe('Threshold — cooldown allow escalation', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. warning ativo + critical transition → critical passa cooldown', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensor = await ensureSensor({
      external_id: 'E2E_COOL_ESCAL_SENSOR',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E Cool Escalation',
      thresholds: {
        warning: { min: 30, max: 40 },
        critical: { min: 20, max: 50 },
      },
      cooldown_seconds: 60,
      recovery_enabled: false,
    });
    await bindProfileToSensor(profile.id, sensor.id);
    await clearAlertEvents(sensor.id);

    // Warning event 1
    const before1 = new Date();
    await ingestReading(sensor.id, 45);
    const ev1 = await waitForAlertEventBySensor(sensor.id, 'warning', {
      since: before1,
      timeout_ms: 8000,
    });
    expect(ev1.severity).toBe('warning');

    // Reset state pra simular nova transition warning→critical
    await ingestReading(sensor.id, 35);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensor.id);

    // Escalation: critical event mesmo com cooldown ativo
    const before2 = new Date();
    await ingestReading(sensor.id, 55);
    const ev2 = await waitForAlertEventBySensor(sensor.id, 'critical', {
      since: before2,
      timeout_ms: 8000,
    });
    expect(ev2.severity).toBe('critical');
  });
});
