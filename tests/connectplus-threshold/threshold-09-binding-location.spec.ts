/**
 * Threshold engine — binding_type location (1:N).
 *
 * Profile aplica a TODOS sensores em uma location específica.
 * Permite configuração massiva por área física (ex: profile de
 * temperatura aplica a todos sensores da sala A).
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS, E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';
import {
  createThresholdProfile,
  bindProfileToLocation,
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

async function createLocation(name: string): Promise<string> {
  const id = randomUUID();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
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
        name,
        location_type: 'sector',
        is_active: true,
      },
    ]),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return id;
}

async function setSensorLocation(sensor_id: string, location_id: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/iot_sensors?id=eq.${sensor_id}`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ location_id }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

async function cleanupLocations(): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/locations?tenant_id=eq.${E2E_TENANT_ID}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
}

test.describe('Threshold — binding location (1:N)', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
    await cleanupLocations();
  });

  test('1. Profile bound a location aplica a todos sensores naquela location', async () => {
    await cleanupThreshold();
    await cleanupLocations();
    const tempTypeId = await getSensorTypeId('Temperatura');

    const locationId = await createLocation('E2E Sala A');

    const s1 = await ensureSensor({
      external_id: 'E2E_LOC_BIND_1',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    const s2 = await ensureSensor({
      external_id: 'E2E_LOC_BIND_2',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });
    await setSensorLocation(s1.id, locationId);
    await setSensorLocation(s2.id, locationId);

    const profile = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      name: 'E2E Location Binding',
      thresholds: { warning: { min: 30, max: 40 } },
      cooldown_seconds: 0,
    });
    await bindProfileToLocation(profile.id, locationId);

    // Ambos sensores na mesma location → mesmo profile aplica
    await clearAlertEvents(s1.id);
    await ingestReading(s1.id, 45);
    const event1 = await waitForAlertEventBySensor(s1.id, 'warning', {
      timeout_ms: 10000,
    });
    expect(event1.severity).toBe('warning');

    await clearAlertEvents(s2.id);
    await ingestReading(s2.id, 50);
    const event2 = await waitForAlertEventBySensor(s2.id, 'warning', {
      timeout_ms: 10000,
    });
    expect(event2.severity).toBe('warning');
  });
});
