/**
 * Threshold engine — binding_type sensor_type + location.
 *
 * Binding 1:N: profile aplica a TODOS sensores do mesmo type (ou em location).
 * Aliva configuração massiva (ex: profile temperatura aplica a todos
 * sensores de temperatura sem precisar bind individual).
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS, E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';
import {
  createThresholdProfile,
  bindProfileToSensorType,
  ingestReading,
  waitForAlertEventBySensor,
  clearAlertEvents,
  cleanupThreshold,
  getSensorTypeId,
} from './threshold-helpers';

test.describe('Threshold — binding sensor_type (1:N)', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. Profile bound to sensor_type aplica a múltiplos sensores', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    // Cria 2 sensores tipo Temperatura
    const s1 = await ensureSensor({
      external_id: 'E2E_TEMP_TYPE_BIND_1',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const s2 = await ensureSensor({
      external_id: 'E2E_TEMP_TYPE_BIND_2',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });

    // Profile bound ao sensor_type_id (não sensor específico)
    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E Type Binding',
      thresholds: { warning: { min: 30, max: 40 } },
      cooldown_seconds: 0,
    });
    await bindProfileToSensorType(profile.id, tempTypeId);

    // Reading sensor 1 → warning event 1
    await clearAlertEvents(s1.id);
    await ingestReading(s1.id, 45);
    const event1 = await waitForAlertEventBySensor(s1.id, 'warning', {
      timeout_ms: 10000,
    });
    expect(event1.severity).toBe('warning');

    // Reading sensor 2 → warning event 2 (mesmo profile)
    await clearAlertEvents(s2.id);
    await ingestReading(s2.id, 50);
    const event2 = await waitForAlertEventBySensor(s2.id, 'warning', {
      timeout_ms: 10000,
    });
    expect(event2.severity).toBe('warning');
  });
});
