/**
 * Threshold engine — correlation conditions AND/OR.
 *
 * Multi-sensor evaluation: alert dispara quando primary band + correlations
 * com outros sensores satisfazem.
 *
 * Combine logic (profile_evaluator.py:830-835):
 *   - AND: primary band + correlations AND-satisfied → final = band
 *          (correlations não-satisfied → final = normal)
 *   - OR: primary band normal + correlations satisfied → final = warning
 *         (warning de band ainda passa)
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS } from '../helpers/iot-context';
import {
  createThresholdProfile,
  bindProfileToSensor,
  createCorrelationGroup,
  createCorrelationCondition,
  ingestReading,
  waitForAlertEventBySensor,
  clearAlertEvents,
  cleanupThreshold,
  getSensorTypeId,
} from './threshold-helpers';

test.describe('Threshold — correlation conditions AND/OR', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
  });

  // FLAKY: timing-sensitive. Worker processa primary reading ANTES da correlation
  // condition row ser visible em outra session. Em isolated test passa, em batch
  // suite race com creates anteriores. Backlog: refatorar pra criar correlation
  // ANTES de qualquer ingest (forçar order), ou aumentar sleep > worker poll interval.
  test.fixme('1. AND — primary warning + correlation satisfied → warning fires', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    const presTypeId = await getSensorTypeId('Pressão');

    const sensorPrimary = await ensureSensor({
      external_id: 'E2E_CORR_AND_PRIMARY',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const sensorSecondary = await ensureSensor({
      external_id: 'E2E_CORR_AND_SECONDARY',
      sensor_type_name: 'Pressão',
      gateway_id: E2E_GATEWAYS.khompV2,
    });

    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E Corr AND',
      thresholds: { warning: { min: 30, max: 40 } },
      cooldown_seconds: 0,
      recovery_enabled: false,
    });
    await bindProfileToSensor(profile.id, sensorPrimary.id);

    // AND group: pressão > 5
    const group = await createCorrelationGroup(profile.id, 'AND');
    await createCorrelationCondition({
      correlation_id: group.id,
      target_type: 'sensor',
      sensor_id: sensorSecondary.id,
      operator: 'gt',
      value_primary: 5,
    });

    // Setup: pressão satisfaz correlation
    await ingestReading(sensorSecondary.id, 8);
    await new Promise((r) => setTimeout(r, 3500));

    // Primary entra em warning band (45 > 40)
    await clearAlertEvents(sensorPrimary.id);
    const before = new Date(Date.now() - 5_000);
    await ingestReading(sensorPrimary.id, 45);
    const event = await waitForAlertEventBySensor(sensorPrimary.id, 'warning', {
      since: before,
      timeout_ms: 15000,
    });
    expect(event.severity).toBe('warning');
  });

  test('2. AND — primary warning + correlation FAIL → normal (sem alert)', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensorPrimary = await ensureSensor({
      external_id: 'E2E_CORR_AND_FAIL_PRIMARY',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const sensorSecondary = await ensureSensor({
      external_id: 'E2E_CORR_AND_FAIL_SEC',
      sensor_type_name: 'Pressão',
      gateway_id: E2E_GATEWAYS.khompV2,
    });

    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E Corr AND Fail',
      thresholds: { warning: { min: 30, max: 40 } },
      cooldown_seconds: 0,
    });
    await bindProfileToSensor(profile.id, sensorPrimary.id);

    const group = await createCorrelationGroup(profile.id, 'AND');
    await createCorrelationCondition({
      correlation_id: group.id,
      target_type: 'sensor',
      sensor_id: sensorSecondary.id,
      operator: 'gt',
      value_primary: 5,
    });

    // Pressão NÃO satisfaz (1 < 5)
    await ingestReading(sensorSecondary.id, 1);
    await new Promise((r) => setTimeout(r, 1000));

    await clearAlertEvents(sensorPrimary.id);
    const before = new Date(Date.now() - 5_000);
    await ingestReading(sensorPrimary.id, 45);

    // AND fail → final=normal → sem warning event
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

  test.fixme('3. OR — primary normal + correlation satisfied → warning fires', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensorPrimary = await ensureSensor({
      external_id: 'E2E_CORR_OR_PRIMARY',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const sensorSecondary = await ensureSensor({
      external_id: 'E2E_CORR_OR_SECONDARY',
      sensor_type_name: 'Pressão',
      gateway_id: E2E_GATEWAYS.khompV2,
    });

    // Profile com correlation_combine_logic=OR direto na criação
    const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
    const KEY =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    const profileId = (await import('node:crypto')).randomUUID();
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const companyId = '22222222-2222-4222-8222-222222222221';
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
          tenant_id: tenantId,
          company_id: companyId,
          sensor_type_id: tempTypeId,
          name: 'E2E Corr OR',
          thresholds: { warning: { min: 30, max: 40 } },
          cooldown_seconds: 0,
          recovery_enabled: true,
          recovery_flap_window_seconds: 5,
          evaluation_window_seconds: 60,
          correlation_combine_logic: 'OR',
          category: 'processo',
          is_active: true,
        },
      ]),
    });
    expect(createRes.ok).toBe(true);

    await bindProfileToSensor(profileId, sensorPrimary.id);
    const group = await createCorrelationGroup(profileId, 'OR');
    await createCorrelationCondition({
      correlation_id: group.id,
      target_type: 'sensor',
      sensor_id: sensorSecondary.id,
      operator: 'gt',
      value_primary: 5,
    });

    // Secondary satisfaz (10 > 5)
    await ingestReading(sensorSecondary.id, 10);
    await new Promise((r) => setTimeout(r, 3500));

    // Primary em zona normal
    await clearAlertEvents(sensorPrimary.id);
    const before = new Date(Date.now() - 5_000);
    await ingestReading(sensorPrimary.id, 35);

    // OR + correlation satisfied → warning fires
    const event = await waitForAlertEventBySensor(sensorPrimary.id, 'warning', {
      since: before,
      timeout_ms: 15000,
    });
    expect(event.severity).toBe('warning');
  });
});
