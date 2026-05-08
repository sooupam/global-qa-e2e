/**
 * Helpers Phase 5 — Notification dispatch real.
 *
 * Cobertura: dispatch-notification EF integration end-to-end.
 *   • Webhook (com allowlist tenant_registry.config)
 *   • Email (inbucket REST polling)
 *   • Notification_logs validation
 */

import { E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
export const KEY =
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
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

/** Update tenant_registry.config.webhook_allowlist + connectplus_plan. */
export async function setupTenantWebhookAllowlist(hosts: string[]): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_registry?id=eq.${E2E_TENANT_ID}`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      config: { webhook_allowlist: hosts },
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
}

export interface DispatchPayload {
  channel_id: string;
  recipients: { type: 'email' | 'phone' | 'user_id' | 'url'; value: string }[];
  subject?: string;
  body: string;
  context?: Record<string, unknown>;
}

export async function callDispatchNotification(
  payload: DispatchPayload,
  company_id: string = E2E_COMPANIES.A
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-notification`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'X-Company-Id': company_id,
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

export async function findNotificationLogs(channel_id: string): Promise<
  {
    id: string;
    status: string;
    error_message: string | null;
    recipient: string;
  }[]
> {
  return (await pgRequest(
    'GET',
    `/notification_logs?channel_id=eq.${channel_id}&order=created_at.desc&limit=10`
  )) as { id: string; status: string; error_message: string | null; recipient: string }[];
}

export async function cleanupNotificationLogs(): Promise<void> {
  await pgRequest('DELETE', `/notification_logs?tenant_id=eq.${E2E_TENANT_ID}`);
}
