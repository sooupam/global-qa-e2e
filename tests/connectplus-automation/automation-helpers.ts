/**
 * Helpers Phase 5 — Automation flows + Notifications.
 *
 * Cobertura: schema validation + cadastro CRUD via PostgREST.
 * NÃO testa dispatch real (depende de Phase 4 trigger pipeline desbloqueado).
 */

import { randomUUID } from 'node:crypto';
import { E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export async function pgRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface AutomationFlowOpts {
  name?: string;
  flow_definition?: object;
  is_active?: boolean;
  source?: string;
  company_id?: string;
}

export async function createAutomationFlow(opts: AutomationFlowOpts = {}): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_automation_flows', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id: opts.company_id ?? E2E_COMPANIES.A,
      name: opts.name ?? `E2E Flow ${id.slice(0, 8)}`,
      flow_definition: opts.flow_definition ?? {
        nodes: [
          { id: 'trigger-1', type: 'trigger', data: { kind: 'threshold' } },
          { id: 'action-1', type: 'action', data: { kind: 'notify' } },
        ],
        edges: [{ id: 'e1', source: 'trigger-1', target: 'action-1' }],
      },
      is_active: opts.is_active ?? true,
      source: opts.source ?? 'manual',
    },
  ]);
  return { id };
}

export interface ProfileActionOpts {
  profile_id: string;
  trigger_severity: 'warning' | 'critical' | 'recovery';
  action_type: 'notify' | 'webhook' | 'create_wo' | 'escalate' | 'set_status' | 'silence';
  config?: object;
  delay_minutes?: number;
  debounce_minutes?: number;
  order_index?: number;
  company_id?: string;
}

export async function createProfileAction(opts: ProfileActionOpts): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/iot_threshold_profile_actions', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id: opts.company_id ?? E2E_COMPANIES.A,
      profile_id: opts.profile_id,
      trigger_severity: opts.trigger_severity,
      action_type: opts.action_type,
      config: opts.config ?? {},
      delay_minutes: opts.delay_minutes ?? 0,
      debounce_minutes: opts.debounce_minutes ?? 0,
      order_index: opts.order_index ?? 0,
      is_active: true,
    },
  ]);
  return { id };
}

export interface NotificationChannelOpts {
  name?: string;
  channel_type: 'email' | 'whatsapp' | 'webhook' | 'sms' | 'push' | 'telegram';
  config?: object;
  company_id?: string;
}

export async function createNotificationChannel(
  opts: NotificationChannelOpts
): Promise<{ id: string }> {
  const id = randomUUID();
  await pgRequest('POST', '/notification_channels', [
    {
      id,
      tenant_id: E2E_TENANT_ID,
      company_id: opts.company_id ?? E2E_COMPANIES.A,
      name: opts.name ?? `E2E Channel ${id.slice(0, 8)}`,
      channel_type: opts.channel_type,
      config: opts.config ?? {},
      is_active: true,
    },
  ]);
  return { id };
}

export async function cleanupAutomation(): Promise<void> {
  await pgRequest('DELETE', `/iot_threshold_profile_actions?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/iot_automation_flows?tenant_id=eq.${E2E_TENANT_ID}`);
  await pgRequest('DELETE', `/notification_channels?tenant_id=eq.${E2E_TENANT_ID}`);
}
