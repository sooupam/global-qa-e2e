/**
 * Threshold engine — silence active (F4.3).
 *
 * iot_alert_silences row pra (profile_id, sensor_id) com silenced_until
 * futuro suprime alert_event INSERT. Worker ainda atualiza state, mas
 * NÃO emite event nem aciona ações.
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS, E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';
import {
  createThresholdProfile,
  bindProfileToSensor,
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

async function createSilence(
  profile_id: string,
  sensor_id: string,
  durationMinutes = 10
): Promise<string> {
  const id = randomUUID();
  const until = new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/iot_alert_silences`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([
      {
        id,
        tenant_id: E2E_TENANT_ID,
        company_id: E2E_COMPANIES.A,
        profile_id,
        sensor_id,
        silenced_until: until,
        reason: 'E2E test silence',
        source: 'manual',
      },
    ]),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return id;
}

async function cleanupSilences(): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/iot_alert_silences?tenant_id=eq.${E2E_TENANT_ID}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
}

test.describe('Threshold — silence (F4.3)', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
    await cleanupSilences();
  });

  test('1. silence ativa suprime alert_event apesar de transition', async () => {
    await cleanupThreshold();
    await cleanupSilences();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const sensor = await ensureSensor({
      external_id: 'E2E_SILENCE_SENSOR',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E Silence Profile',
      thresholds: { warning: { min: 30, max: 40 } },
      cooldown_seconds: 0,
    });
    await bindProfileToSensor(profile.id, sensor.id);

    // Cria silence ativa pra (profile, sensor)
    await createSilence(profile.id, sensor.id, 10);

    await clearAlertEvents(sensor.id);
    const before = new Date();
    // Reading que disparia warning normalmente
    await ingestReading(sensor.id, 45);

    // Deve NÃO criar event
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
