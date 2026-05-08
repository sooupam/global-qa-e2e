/**
 * Threshold engine — zones (multi-band explícito).
 *
 * Zones têm prioridade sobre legacy warning/critical. Cada zone tem
 * `min`/`max` (intervalo inclusivo) + `severity`. Avalia worst-rank.
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

test.describe('Threshold — zones (multi-band)', () => {
  let sensorId: string;
  let profileId: string;

  test.beforeAll(async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    sensorId = (
      await ensureSensor({
        external_id: 'E2E_TEMP_ZONES',
        sensor_type_name: 'Temperatura',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;
    // Zones: 0-15 critical (frio), 15-22 warning, 22-28 normal, 28-35 warning, 35+ critical (calor)
    profileId = (
      await createThresholdProfile({
        sensor_type_id: tempTypeId,
        name: 'E2E Temp Zones',
        thresholds: {
          zones: [
            { min: 0, max: 15, severity: 'critical', label: 'frio extremo' },
            { min: 15, max: 22, severity: 'warning', label: 'frio' },
            { min: 22, max: 28, severity: 'normal', label: 'normal' },
            { min: 28, max: 35, severity: 'warning', label: 'quente' },
            { min: 35, max: 100, severity: 'critical', label: 'calor extremo' },
          ],
        },
        cooldown_seconds: 0,
        recovery_enabled: false,
      })
    ).id;
    await bindProfileToSensor(profileId, sensorId);
  });

  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. value=18 → zone "frio" → severity warning', async () => {
    await clearAlertEvents(sensorId);
    // Reset to normal first
    await ingestReading(sensorId, 25);
    await new Promise((r) => setTimeout(r, 1000));
    await clearAlertEvents(sensorId);
    const before = new Date();
    await ingestReading(sensorId, 18);
    const event = await waitForAlertEventBySensor(sensorId, 'warning', {
      since: before,
      timeout_ms: 8000,
    });
    expect(event.severity).toBe('warning');
  });

  test('2. value=10 → zone "frio extremo" → severity critical', async () => {
    await ingestReading(sensorId, 25);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);
    const before = new Date();
    await ingestReading(sensorId, 10);
    const event = await waitForAlertEventBySensor(sensorId, 'critical', {
      since: before,
      timeout_ms: 8000,
    });
    expect(event.severity).toBe('critical');
  });

  test('3. value=40 → zone "calor extremo" → severity critical', async () => {
    await ingestReading(sensorId, 25);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);
    const before = new Date();
    await ingestReading(sensorId, 40);
    const event = await waitForAlertEventBySensor(sensorId, 'critical', {
      since: before,
      timeout_ms: 8000,
    });
    expect(event.severity).toBe('critical');
  });
});
