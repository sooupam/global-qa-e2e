/**
 * Threshold engine — flatline detection (F4.2c).
 *
 * profile.thresholds.flatline_seconds + flatline_tolerance.
 * Worker checa se max(value) - min(value) < tolerance na janela. Se sim,
 * sensor "travado" (sem variação real) → severity critical.
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

test.describe('Threshold — flatline detection', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. múltiplos readings idênticos → critical (sensor travado)', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensor = await ensureSensor({
      external_id: 'E2E_FLATLINE_SENSOR',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E Flatline',
      thresholds: {
        flatline_seconds: 60,
        flatline_tolerance: 0.5,
      },
      cooldown_seconds: 0,
    });
    await bindProfileToSensor(profile.id, sensor.id);
    await clearAlertEvents(sensor.id);

    // 1 reading inicial — count=1 não dispara flatline
    const before = new Date();
    await ingestReading(sensor.id, 25);
    await new Promise((r) => setTimeout(r, 500));
    // 2nd reading — count=2, max-min=0.1<0.5 → flatline → critical event
    await ingestReading(sensor.id, 25.1);

    const event = await waitForAlertEventBySensor(sensor.id, 'critical', {
      since: before,
      timeout_ms: 10000,
    });
    expect(event.severity).toBe('critical');
  });
});
