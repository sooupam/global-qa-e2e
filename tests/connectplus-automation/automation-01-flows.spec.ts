/**
 * Automation Flows — schema + CRUD validation.
 *
 * Phase 5 cobertura realista:
 *   • CRUD de iot_automation_flows
 *   • CRUD de iot_threshold_profile_actions (6 action_types)
 *   • CRUD de notification_channels (6 channel_types)
 *   • Schema constraints validation
 *
 * NÃO cobre dispatch end-to-end (depende Phase 4 desbloquear trigger pipeline).
 */

import { test, expect } from '@playwright/test';
import {
  createAutomationFlow,
  createProfileAction,
  createNotificationChannel,
  cleanupAutomation,
  pgRequest,
} from './automation-helpers';
import {
  createThresholdProfile,
  cleanupThreshold,
  getSensorTypeId,
} from '../connectplus-threshold/threshold-helpers';
import { E2E_TENANT_ID } from '../helpers/iot-context';

test.describe('Automation flows + actions + channels', () => {
  test.afterAll(async () => {
    await cleanupAutomation();
    await cleanupThreshold();
  });

  test('1. createAutomationFlow inserts row with valid flow_definition', async () => {
    const { id } = await createAutomationFlow({
      name: 'E2E Flow simple',
      flow_definition: {
        nodes: [
          { id: 't1', type: 'trigger' },
          { id: 'a1', type: 'action' },
        ],
        edges: [{ id: 'e1', source: 't1', target: 'a1' }],
      },
    });
    const rows = (await pgRequest('GET', `/iot_automation_flows?id=eq.${id}`)) as {
      id: string;
      flow_definition: { nodes: unknown[] };
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].flow_definition.nodes).toHaveLength(2);
  });

  test('2. each action_type cadastrável (6 variantes)', async () => {
    const tempTypeId = await getSensorTypeId('Temperatura');
    const { id: profileId } = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      thresholds: { warning: { min: 30, max: 40 } },
      cooldown_seconds: 0,
    });

    const types: Array<'notify' | 'webhook' | 'create_wo' | 'escalate' | 'set_status' | 'silence'> =
      ['notify', 'webhook', 'create_wo', 'escalate', 'set_status', 'silence'];

    for (let i = 0; i < types.length; i++) {
      const action = await createProfileAction({
        profile_id: profileId,
        trigger_severity: 'warning',
        action_type: types[i],
        config: { test: types[i] },
        order_index: i,
      });
      expect(action.id).toMatch(/^[0-9a-f-]{36}$/);
    }

    const all = (await pgRequest(
      'GET',
      `/iot_threshold_profile_actions?profile_id=eq.${profileId}`
    )) as { action_type: string }[];
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(new Set(all.map((a) => a.action_type)).size).toBe(6);
  });

  test('3. each notification channel_type cadastrável (6 variantes)', async () => {
    const types: Array<'email' | 'whatsapp' | 'webhook' | 'sms' | 'push' | 'telegram'> = [
      'email',
      'whatsapp',
      'webhook',
      'sms',
      'push',
      'telegram',
    ];
    for (const t of types) {
      const ch = await createNotificationChannel({
        channel_type: t,
        name: `E2E ${t} channel`,
        config: { stub: true },
      });
      expect(ch.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    const all = (await pgRequest(
      'GET',
      `/notification_channels?tenant_id=eq.${E2E_TENANT_ID}`
    )) as { channel_type: string }[];
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(new Set(all.map((c) => c.channel_type)).size).toBe(6);
  });

  test('4. invalid action_type rejeitado pela check constraint', async () => {
    const tempTypeId = await getSensorTypeId('Temperatura');
    const { id: profileId } = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      thresholds: { warning: { min: 30, max: 40 } },
    });

    let threw = false;
    try {
      await createProfileAction({
        profile_id: profileId,
        trigger_severity: 'warning',
        action_type: 'INVALID_TYPE' as 'notify',
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toMatch(/check constraint|invalid/i);
    }
    expect(threw).toBe(true);
  });

  test('5. invalid trigger_severity rejeitado', async () => {
    const tempTypeId = await getSensorTypeId('Temperatura');
    const { id: profileId } = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      thresholds: { warning: { min: 30, max: 40 } },
    });

    let threw = false;
    try {
      await createProfileAction({
        profile_id: profileId,
        trigger_severity: 'BAD' as 'warning',
        action_type: 'notify',
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('6. invalid notification channel_type rejeitado', async () => {
    let threw = false;
    try {
      await createNotificationChannel({
        channel_type: 'pigeon' as 'email',
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('7. delay_minutes negative rejeitado', async () => {
    const tempTypeId = await getSensorTypeId('Temperatura');
    const { id: profileId } = await createThresholdProfile({
      sensor_type_id: tempTypeId,
      thresholds: { warning: { min: 30, max: 40 } },
    });

    let threw = false;
    try {
      await createProfileAction({
        profile_id: profileId,
        trigger_severity: 'warning',
        action_type: 'notify',
        delay_minutes: -5,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
