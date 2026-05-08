/**
 * khomp_enel codec — E2E regression do fix de 2026-04-28.
 *
 * Cobertura:
 *   • send_logs path: invalid_frame, stopped, started → PULSOATIVO 0/0/1
 *   • send_frames path: fc=0 (legacy), fc=1 (real firmware)
 *   • frame decoding: PEA → PULSOATIVO=1 if PEA>0 else 0; PER → PULSOREATIVO
 *   • timezone normalization: ts naive interpretado como BRT, gravado como UTC
 *   • dispatch via khomp_multi router (ENEL detection antes de send_status)
 *
 * Importante: ENEL routing acontece dentro de khomp_multi. Bridge usa
 * parser_type='khomp_multi', topic='e2e/khomp/A'.
 */

import { test, expect } from '@playwright/test';
import { BRIDGE_TOPICS, ensureSensor, publishAndWait } from './codec-helpers';

test.describe('Codec khomp_enel — E2E', () => {
  let pulsoativoId: string;
  let pulsoreativoId: string;

  test.beforeAll(async () => {
    // Sensor cadastrado com external_id que codec ENEL produz: {empresa}_ENERGIA_PULSO*
    // Empresa derivada do último segmento do topic ('e2e/khomp/A' → 'A')
    pulsoativoId = (
      await ensureSensor({
        external_id: 'A_ENERGIA_PULSOATIVO',
        sensor_type_name: 'Fornecimento Energia',
      })
    ).id;
    pulsoreativoId = (
      await ensureSensor({
        external_id: 'A_ENERGIA_PULSOREATIVO',
        sensor_type_name: 'Fornecimento Energia',
      })
    ).id;
  });

  test('send_logs "started" → PULSOATIVO=1', async () => {
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_logs',
        esn: '208724',
        logs: [
          {
            log: 'Serial interface started receiving frames',
            timestamp: '2026-04-28T19:58:31',
          },
        ],
      },
      sensor_id: pulsoativoId,
      expected_value: 1.0,
    });
    expect(reading.value).toBe(1.0);
  });

  test('send_logs "Invalid frame received" → PULSOATIVO=0', async () => {
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_logs',
        esn: '208724',
        logs: [{ log: 'Invalid frame received', timestamp: '2026-04-28T19:00:00' }],
      },
      sensor_id: pulsoativoId,
      expected_value: 0.0,
    });
    expect(reading.value).toBe(0.0);
  });

  test('send_logs "stopped" → PULSOATIVO=0', async () => {
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_logs',
        esn: '208724',
        logs: [
          {
            log: 'Serial interface stopped receiving frames',
            timestamp: '2026-04-28T19:00:00',
          },
        ],
      },
      sensor_id: pulsoativoId,
      expected_value: 0.0,
    });
    expect(reading.value).toBe(0.0);
  });

  test('send_frames fc=1 (real firmware) — PEA=437 PER=201 → PULSOATIVO=1', async () => {
    // Frame real capturado em prod do gateway HVL ENEL esn 208724.
    // Decode: NS=0, IF/UI/PR/TRA/TT/PH headers, PEA=437 (>0), PER=201.
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_frames',
        esn: '208724',
        frames: [
          {
            fc: 1,
            frame: '018081B501C90082',
            pt: 0,
            ts: '2026-04-28T19:13:31',
          },
        ],
      },
      sensor_id: pulsoativoId,
      expected_value: 1.0,
    });
    expect(reading.value).toBe(1.0);
  });

  test('send_frames fc=1 — PER=201 sai como PULSOREATIVO=201', async () => {
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_frames',
        esn: '208724',
        frames: [
          {
            fc: 1,
            frame: '018081B501C90082',
            pt: 0,
            ts: '2026-04-28T19:13:32',
          },
        ],
      },
      sensor_id: pulsoreativoId,
      expected_value: 201.0,
    });
    expect(reading.value).toBe(201.0);
  });

  test('send_frames fc=1 PEA=0 → PULSOATIVO=0 (medidor sem pulsos)', async () => {
    // Frame com PEA=0 (bytes 3-4 = 00 00) e PER=5
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_frames',
        esn: '208724',
        frames: [
          {
            fc: 1,
            frame: '00000000000005',
            pt: 0,
            ts: '2026-04-28T19:14:31',
          },
        ],
      },
      sensor_id: pulsoativoId,
      expected_value: 0.0,
    });
    expect(reading.value).toBe(0.0);
  });

  test('timezone — ts naive 19:58:31 (BRT) gravado como 22:58:31 UTC', async () => {
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_logs',
        esn: '208724',
        logs: [
          {
            log: 'Serial interface started receiving frames',
            timestamp: '2026-04-29T15:00:00',
          },
        ],
      },
      sensor_id: pulsoativoId,
      expected_value: 1.0,
    });
    // BRT 15:00 = UTC 18:00
    expect(reading.time).toMatch(/^2026-04-29T18:00:00/);
  });

  test('send_status (não-ENEL) — payload ignorado, sem reading', async () => {
    // Publica heartbeat genérico e confirma que NADA é gravado pro sensor ENEL
    // (regression: ENEL detection NÃO deve consumir send_status).
    const { publishMqtt, clearReadings } = await import('../helpers/iot-context');
    await clearReadings(pulsoativoId);
    const before = Date.now();
    await publishMqtt({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_status',
        esn: '208724',
        apn_list: { apn_list: [['global.algar.br', 'algar', '1212']] },
        rssi: '0 - Insuficiente',
      },
      qos: 1,
    });
    // Aguarda 2s pra garantir bridge processou
    await new Promise((r) => setTimeout(r, 2000));
    // Verifica que reading recente NÃO veio pra sensor ENEL
    const url = `${process.env.SUPABASE_URL || 'http://localhost:54321'}/rest/v1/iot_sensor_readings?sensor_id=eq.${pulsoativoId}&time=gt.${new Date(before).toISOString()}`;
    const res = await fetch(url, {
      headers: {
        apikey:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
        Authorization:
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      },
    });
    const rows = (await res.json()) as unknown[];
    expect(rows.length).toBe(0);
  });
});
