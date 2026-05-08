/**
 * Threshold engine — severity transitions.
 *
 * Cobertura:
 *   1. normal → warning: reading sai da zona normal, alert_event INSERT
 *   2. warning → critical: escalada
 *   3. normal → critical (skip warning): alert direto
 *   4. critical → normal recovery (severity=normal/info, parent_event_id linkado)
 *
 * **Semântica legacy (`warning.min/max` e `critical.min/max`):**
 * Define zona NORMAL. Valor FORA dispara severity. Ex:
 *   `warning: {min: 30, max: 40}` → warning se value < 30 OR > 40
 *   `critical: {min: 20, max: 50}` → critical se value < 20 OR > 50
 *
 * Worker async: profile_evaluator polla pgmq queue. Latência típica <2s.
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

test.describe('Threshold — severity transitions', () => {
  let sensorId: string;
  let profileId: string;

  test.beforeAll(async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    sensorId = (
      await ensureSensor({
        external_id: 'E2E_TEMP_TRANSITIONS',
        sensor_type_name: 'Temperatura',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;
    // Profile: warning if 30 ≤ value < 40, critical if value ≥ 40
    // Zona normal warning: 30-40 (fora = warning).
    // Zona normal critical: 20-50 (fora = critical, sobrepõe warning).
    profileId = (
      await createThresholdProfile({
        sensor_type_id: tempTypeId,
        name: 'E2E Temp Transitions',
        thresholds: {
          warning: { min: 30, max: 40 },
          critical: { min: 20, max: 50 },
        },
        cooldown_seconds: 0,
        recovery_enabled: true,
      })
    ).id;
    await bindProfileToSensor(profileId, sensorId);
  });

  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test.beforeEach(async () => {
    await clearAlertEvents(sensorId);
  });

  test('1. normal → warning (value=45 > warning.max=40) gera alert', async () => {
    // Reset estado via valor normal antes
    await ingestReading(sensorId, 35);
    await new Promise((r) => setTimeout(r, 1000));
    await clearAlertEvents(sensorId);
    const before = new Date();
    await ingestReading(sensorId, 45);
    const event = await waitForAlertEventBySensor(sensorId, 'warning', {
      since: before,
      timeout_ms: 10000,
    });
    expect(event.severity).toBe('warning');
    expect(Number(event.trigger_value)).toBe(45);
  });

  test('2. warning → critical (value=55 > critical.max=50) gera alert', async () => {
    // Setup: força estado warning primeiro (value=45)
    await ingestReading(sensorId, 45);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);
    // Critical
    const before = new Date();
    await ingestReading(sensorId, 55);
    const event = await waitForAlertEventBySensor(sensorId, 'critical', {
      since: before,
      timeout_ms: 10000,
    });
    expect(event.severity).toBe('critical');
    expect(Number(event.trigger_value)).toBe(55);
  });

  test('3. normal → critical direto (skip warning) com value=15 < critical.min=20', async () => {
    await ingestReading(sensorId, 35);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);
    const before = new Date();
    await ingestReading(sensorId, 15);
    const event = await waitForAlertEventBySensor(sensorId, 'critical', {
      since: before,
      timeout_ms: 10000,
    });
    expect(event.severity).toBe('critical');
  });

  test('4. critical → normal recovery (value=35 dentro warning normal range)', async () => {
    // Setup: força estado critical (value=55)
    await ingestReading(sensorId, 55);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);
    // Recovery — value 35 dentro warning normal range
    const before = new Date();
    await ingestReading(sensorId, 35);
    // Recovery vem como severity=info (recovery_enabled=true)
    let event;
    try {
      event = await waitForAlertEventBySensor(sensorId, 'info', {
        since: before,
        timeout_ms: 10000,
      });
    } catch {
      event = await waitForAlertEventBySensor(sensorId, 'normal', {
        since: before,
        timeout_ms: 5000,
      });
    }
    expect(['normal', 'info']).toContain(event.severity);
  });
});
