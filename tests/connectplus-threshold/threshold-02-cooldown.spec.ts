/**
 * Threshold engine — cooldown.
 *
 * Cooldown bloqueia evento ativo de severity igual OU maior que a
 * existente. Permite escalonamento warning → critical (rank crescente).
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

test.describe('Threshold — cooldown', () => {
  let sensorId: string;
  let profileId: string;

  test.beforeAll(async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    sensorId = (
      await ensureSensor({
        external_id: 'E2E_TEMP_COOLDOWN',
        sensor_type_name: 'Temperatura',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;
    profileId = (
      await createThresholdProfile({
        sensor_type_id: tempTypeId,
        name: 'E2E Temp Cooldown',
        thresholds: { warning: { min: 30, max: 40 } },
        cooldown_seconds: 60,
        recovery_enabled: false,
      })
    ).id;
    await bindProfileToSensor(profileId, sensorId);
  });

  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. dois warnings consecutivos — segundo bloqueado por cooldown', async () => {
    await clearAlertEvents(sensorId);
    // Primeiro warning
    const before1 = new Date();
    await ingestReading(sensorId, 45);
    const event1 = await waitForAlertEventBySensor(sensorId, 'warning', {
      since: before1,
      timeout_ms: 8000,
    });
    expect(event1).toBeDefined();
    // Reset state pra simular nova transition
    await ingestReading(sensorId, 35);
    await new Promise((r) => setTimeout(r, 1500));
    // Segundo warning dentro de cooldown 60s
    const before2 = new Date();
    await ingestReading(sensorId, 46);
    // NÃO deve emitir alert (cooldown ativo)
    let blocked = false;
    try {
      await waitForAlertEventBySensor(sensorId, 'warning', {
        since: before2,
        timeout_ms: 5000,
      });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });
});
