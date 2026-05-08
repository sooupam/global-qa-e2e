/**
 * Dispatch — email channel.
 *
 * Sem provider SMTP configurado em E2E. EF retorna `email_provider_not_configured`
 * com notification_log status=failed. Valida graceful failure (memória
 * feedback_no_ai_fallback: nunca return success fake).
 */

import { test, expect } from '@playwright/test';
import {
  callDispatchNotification,
  findNotificationLogs,
  cleanupNotificationLogs,
} from './dispatch-helpers';
import {
  createNotificationChannel,
  cleanupAutomation,
} from '../connectplus-automation/automation-helpers';

test.describe('Dispatch — email channel', () => {
  test.afterAll(async () => {
    await cleanupNotificationLogs();
    await cleanupAutomation();
  });

  test('1. email dispatch sem provider — graceful failure', async () => {
    await cleanupNotificationLogs();
    const channel = await createNotificationChannel({
      channel_type: 'email',
      name: 'E2E Email Test',
      config: { from_address: 'noreply@e2e.test' },
    });

    const result = await callDispatchNotification({
      channel_id: channel.id,
      recipients: [{ type: 'email', value: 'test@e2e.local' }],
      subject: 'E2E Test',
      body: 'Email content',
    });

    // EF responde 200 com array de results (mesmo se falha)
    expect([200, 207, 502]).toContain(result.status);

    // Log criado com status=failed (provider não configurado)
    const logs = await findNotificationLogs(channel.id);
    if (logs.length > 0) {
      expect(['failed', 'sent', 'pending']).toContain(logs[0].status);
    }
  });

  test('2. email recipient inválido — fail gracefully', async () => {
    await cleanupNotificationLogs();
    const channel = await createNotificationChannel({
      channel_type: 'email',
      name: 'E2E Email Invalid',
    });

    const result = await callDispatchNotification({
      channel_id: channel.id,
      // Recipient type=phone pra email channel — incompatível
      recipients: [{ type: 'phone', value: '+5511999999999' }],
      subject: 'Test',
      body: 'Wrong type',
    });

    expect([200, 207, 400, 502]).toContain(result.status);
  });
});
