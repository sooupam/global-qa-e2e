/**
 * Threshold engine — rate_of_change detection (F3.12 + F3.13).
 *
 * profile.thresholds.rate_of_change = { threshold, window_seconds, direction, severity }.
 * Worker compara value atual vs primeiro reading na janela. Se |delta| > threshold
 * AND direction match → severity bump.
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

test.describe('Threshold — rate_of_change', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. delta > threshold direction up → severity warning', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensor = await ensureSensor({
      external_id: 'E2E_ROC_SENSOR',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    // Profile sem warning band — só rate_of_change
    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E ROC',
      thresholds: {
        rate_of_change: {
          threshold: 10,
          window_seconds: 60,
          direction: 'up',
          severity: 'warning',
        },
      },
      cooldown_seconds: 0,
    });
    await bindProfileToSensor(profile.id, sensor.id);

    // Reading inicial baixo
    await ingestReading(sensor.id, 20);
    await new Promise((r) => setTimeout(r, 1500));

    // Reading 15 unidades acima — delta=15 > threshold=10, direction=up
    await clearAlertEvents(sensor.id);
    const before = new Date();
    await ingestReading(sensor.id, 35);
    const event = await waitForAlertEventBySensor(sensor.id, 'warning', {
      since: before,
      timeout_ms: 10000,
    });
    expect(event.severity).toBe('warning');
  });

  test('2. delta < threshold → sem alert', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensor = await ensureSensor({
      external_id: 'E2E_ROC_LOW_SENSOR',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E ROC Low',
      thresholds: {
        rate_of_change: {
          threshold: 10,
          window_seconds: 60,
          direction: 'up',
          severity: 'warning',
        },
      },
      cooldown_seconds: 0,
    });
    await bindProfileToSensor(profile.id, sensor.id);

    await ingestReading(sensor.id, 20);
    await new Promise((r) => setTimeout(r, 1500));

    await clearAlertEvents(sensor.id);
    const before = new Date();
    // Delta=5 < 10 → sem alert
    await ingestReading(sensor.id, 25);

    let triggered = false;
    try {
      await waitForAlertEventBySensor(sensor.id, 'warning', {
        since: before,
        timeout_ms: 5000,
      });
      triggered = true;
    } catch {
      triggered = false;
    }
    expect(triggered).toBe(false);
  });
});
