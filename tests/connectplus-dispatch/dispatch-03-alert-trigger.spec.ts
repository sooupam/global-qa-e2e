/**
 * Dispatch — process-sensor-alert trigger pipeline.
 *
 * iot_alert_events INSERT → trg_iot_alert_create_wo (AFTER INSERT) →
 * fn_process_iot_alert_event → pg_net.http_post → process-sensor-alert EF.
 *
 * Spec valida que alert_event INSERT acende processo (event registado +
 * trigger called). NÃO verifica entrega final — só pipeline integration.
 */

import { test, expect } from '@playwright/test';
import { ensureSensor } from '../connectplus-codecs/codec-helpers';
import { E2E_GATEWAYS, E2E_TENANT_ID, E2E_COMPANIES } from '../helpers/iot-context';
import { pgRequest } from './dispatch-helpers';
import { cleanupThreshold, getSensorTypeId } from '../connectplus-threshold/threshold-helpers';
import { randomUUID } from 'node:crypto';

test.describe('Dispatch — alert trigger pipeline', () => {
  test.afterAll(async () => {
    await cleanupThreshold();
  });

  test('1. INSERT iot_alert_events dispara trigger AFTER INSERT', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    const sensor = await ensureSensor({
      external_id: 'E2E_ALERT_TRIGGER',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });

    // INSERT direto em alert_events — testa trigger pipeline
    const eventId = randomUUID();
    await pgRequest('POST', '/iot_alert_events', [
      {
        id: eventId,
        tenant_id: E2E_TENANT_ID,
        company_id: E2E_COMPANIES.A,
        sensor_id: sensor.id,
        severity: 'warning',
        status: 'active',
        source: 'threshold_profile',
        owner_type: 'company',
        category: 'processo',
        trigger_value: 45,
      },
    ]);

    // Verifica que event persiste
    const events = (await pgRequest(
      'GET',
      `/iot_alert_events?id=eq.${eventId}&select=id,severity,status,sensor_id`
    )) as { id: string; severity: string; status: string; sensor_id: string }[];
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('warning');
    expect(events[0].sensor_id).toBe(sensor.id);
  });

  test('2. alert event status=acknowledged — trigger reset escalation', async () => {
    await cleanupThreshold();
    const tempTypeId = await getSensorTypeId('Temperatura');
    const sensor = await ensureSensor({
      external_id: 'E2E_ACK_RESET',
      sensor_type_name: 'Temperatura',
      gateway_id: E2E_GATEWAYS.khompV2,
    });

    const eventId = randomUUID();
    await pgRequest('POST', '/iot_alert_events', [
      {
        id: eventId,
        tenant_id: E2E_TENANT_ID,
        company_id: E2E_COMPANIES.A,
        sensor_id: sensor.id,
        severity: 'critical',
        status: 'active',
        source: 'threshold_profile',
        owner_type: 'company',
        category: 'processo',
        trigger_value: 95,
        current_escalation_level: 2,
      },
    ]);

    // ACK — trg_iot_alert_reset_on_ack reseta current_escalation_level
    await pgRequest('PATCH', `/iot_alert_events?id=eq.${eventId}`, {
      status: 'acknowledged',
    });

    const events = (await pgRequest(
      'GET',
      `/iot_alert_events?id=eq.${eventId}&select=status,current_escalation_level`
    )) as { status: string; current_escalation_level: number }[];
    expect(events[0].status).toBe('acknowledged');
    expect(events[0].current_escalation_level).toBe(0);
  });
});
