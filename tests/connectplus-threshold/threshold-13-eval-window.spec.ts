/**
 * Threshold engine — evaluation_window_seconds stale.
 *
 * Worker (profile_evaluator.py:489-492): se reading correlated_sensor é
 * mais velha que evaluation_window_seconds, condition fica "stale" e
 * retorna False. AND combine logic + stale → final=normal.
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS, E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';
import {
  bindProfileToSensor,
  createCorrelationGroup,
  createCorrelationCondition,
  ingestReading,
  waitForAlertEventBySensor,
  clearAlertEvents,
  cleanupThreshold,
  getSensorTypeId,
} from './threshold-helpers';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('Threshold — evaluation_window stale', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. correlation reading > eval_window → stale → AND fail (sem alert)', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensorPrimary = await ensureSensor({
      external_id: 'E2E_EVAL_WINDOW_PRIMARY',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const sensorSecondary = await ensureSensor({
      external_id: 'E2E_EVAL_WINDOW_SEC',
      sensor_type_name: 'Pressão',
      gateway_id: E2E_GATEWAYS.khompV2,
    });

    // Profile com evaluation_window=10s (curto pra teste)
    const profileId = randomUUID();
    const createRes = await fetch(`${SUPABASE_URL}/rest/v1/iot_threshold_profiles`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([
        {
          id: profileId,
          tenant_id: E2E_TENANT_ID,
          company_id: E2E_COMPANIES.A,
          sensor_type_id: tempTypeId,
          name: 'E2E Eval Window',
          thresholds: { warning: { min: 30, max: 40 } },
          cooldown_seconds: 0,
          recovery_enabled: false,
          recovery_flap_window_seconds: 0,
          evaluation_window_seconds: 10,
          correlation_combine_logic: 'AND',
          category: 'processo',
          is_active: true,
        },
      ]),
    });
    expect(createRes.ok).toBe(true);
    await bindProfileToSensor(profileId, sensorPrimary.id);
    const group = await createCorrelationGroup(profileId, 'AND');
    await createCorrelationCondition({
      correlation_id: group.id,
      target_type: 'sensor',
      sensor_id: sensorSecondary.id,
      operator: 'gt',
      value_primary: 5,
    });

    // Secondary reading old (mais que eval_window=10s atrás)
    // Force last_reading_at = 30s ago
    const oldTime = new Date(Date.now() - 30_000).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/iot_sensors?id=eq.${sensorSecondary.id}`, {
      method: 'PATCH',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ last_value: 8, last_reading_at: oldTime }),
    });

    // Primary entra warning band — correlation stale → AND fail → normal → sem alert
    await clearAlertEvents(sensorPrimary.id);
    const before = new Date(Date.now() - 5_000);
    await ingestReading(sensorPrimary.id, 45);

    let triggered = false;
    try {
      await waitForAlertEventBySensor(sensorPrimary.id, 'warning', {
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
