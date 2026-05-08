/**
 * Threshold engine — state_rules (boolean/mapped sensors).
 *
 * Para sensores tipo Fornecimento Energia (0/1), Status Gerador (0-7),
 * etc. state_rules têm prioridade sobre zones e legacy thresholds.
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

test.describe('Threshold — state_rules (boolean)', () => {
  let sensorId: string;
  let profileId: string;

  test.beforeAll(async () => {
    await cleanupThreshold();
    const typeId = await getSensorTypeId('Fornecimento Energia');
    sensorId = (
      await ensureSensor({
        external_id: 'E2E_FORN_STATE',
        sensor_type_name: 'Fornecimento Energia',
        gateway_id: E2E_GATEWAYS.khompV2,
      })
    ).id;
    // Profile: value=0 → critical (sem fornecimento), value=1 → normal
    profileId = (
      await createThresholdProfile({
        sensor_type_id: typeId,
        name: 'E2E Fornecimento State',
        thresholds: {
          state_rules: [
            { op: 'eq', value: 0, severity: 'critical', label: 'sem energia' },
            { op: 'eq', value: 1, severity: 'normal', label: 'energizado' },
          ],
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

  test('1. fornecimento value=0 → severity critical', async () => {
    await ingestReading(sensorId, 1);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);
    const before = new Date();
    await ingestReading(sensorId, 0);
    const event = await waitForAlertEventBySensor(sensorId, 'critical', {
      since: before,
      timeout_ms: 8000,
    });
    expect(event.severity).toBe('critical');
    expect(Number(event.trigger_value)).toBe(0);
  });

  test('2. fornecimento value=0 → 1 → recovery info', async () => {
    await ingestReading(sensorId, 0);
    await new Promise((r) => setTimeout(r, 1500));
    await clearAlertEvents(sensorId);
    const before = new Date();
    await ingestReading(sensorId, 1);
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
