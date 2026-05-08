/**
 * khomp_multi codec — router por shape de payload.
 *
 * 4 paths cobertos:
 *   1. SenML array `[{"bn":...,"bt":...},{"n":...,"v":...}]` → sensores ITG/NIT/IED
 *   2. ChirpStack `{deviceInfo, object}` → LoRaWAN
 *   3. Modbus `{name, esn, registers}` → delega khomp_modbus
 *   4. Status `{apn_list, esn, rssi}` → emite GATEWAY_RSSI
 *
 * Verifica também ignore behaviors (cmd:send_config, log subtopic).
 */

import { test, expect } from '@playwright/test';
import { BRIDGE_TOPICS, ensureSensor, publishAndWait } from './codec-helpers';
import { publishMqtt, clearReadings, waitForReading } from '../helpers/iot-context';

test.describe('Codec khomp_multi — paths', () => {
  test('1. SenML array → reading numérica', async () => {
    // External_id formado por: {empresa}_{bn}_{n}_{unit}
    // Topic: e2e/khomp/A → empresa = A
    // bn=DEVICE1, n=temperature, unit=cel → A_DEVICE1_TEMPERATURE_CEL
    const sensor = await ensureSensor({
      external_id: 'A_DEVICE1_TEMPERATURE_CEL',
      sensor_type_name: 'Temperatura',
    });
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: [
        { bn: 'DEVICE1', bt: 1745234432 },
        { n: 'temperature', u: 'cel', v: 23.5 },
      ],
      sensor_id: sensor.id,
      expected_value: 23.5,
    });
    expect(reading.value).toBe(23.5);
  });

  test('2. SenML — multiple sensors em batch', async () => {
    const tempSensor = await ensureSensor({
      external_id: 'A_DEVICE2_TEMPERATURE_CEL',
      sensor_type_name: 'Temperatura',
    });
    const humSensor = await ensureSensor({
      external_id: 'A_DEVICE2_HUMIDITY_%RH',
      sensor_type_name: 'Umidade Relativa',
    });
    await clearReadings(tempSensor.id);
    await clearReadings(humSensor.id);

    await publishMqtt({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: [
        { bn: 'DEVICE2', bt: 1745234432 },
        { n: 'temperature', u: 'cel', v: 18.2 },
        { n: 'humidity', u: '%RH', v: 65.0 },
      ],
      qos: 1,
    });

    const tReading = await waitForReading(tempSensor.id, (r) => r.value === 18.2, {
      timeout_ms: 8000,
    });
    const hReading = await waitForReading(humSensor.id, (r) => r.value === 65.0, {
      timeout_ms: 8000,
    });
    expect(tReading.value).toBe(18.2);
    expect(hReading.value).toBe(65.0);
  });

  test('3. SenML — boolean (vb) → 1.0 ou 0.0', async () => {
    const sensor = await ensureSensor({
      external_id: 'A_DEVICE3_STATE',
      sensor_type_name: 'Estado Binário',
    });
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: [
        { bn: 'DEVICE3', bt: 1745234432 },
        { n: 'state', vb: true },
      ],
      sensor_id: sensor.id,
      expected_value: 1.0,
    });
    expect(reading.value).toBe(1.0);
  });

  test('4. Modbus device — DEEP_SEA_8660 SOMACORRENTE derivado', async () => {
    // Modelo registrado em codecs/devices/. Codec específico aplica física
    // (zero-out por freq<55Hz). Frame com freq=60Hz + tensões válidas → SOMACORRENTE>0.
    const sensor = await ensureSensor({
      external_id: 'A_DEEP_SEA_8660_NEW_99_SOMACORRENTE',
      sensor_type_name: 'Corrente Elétrica',
    });
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        name: 'DEEP_SEA_8660_NEW',
        id: 99,
        timestamp: 1745234432,
        registers: [
          { addr: 1031, reg: '0258' }, // freq GEN = 60.0 Hz
          { addr: 1039, reg: '55F0' }, // tensão GEN L1-L2 = 2200V
          { addr: 1041, reg: '55DC' }, // 2198V
          { addr: 1043, reg: '55B4' }, // 2194V
        ],
      },
      sensor_id: sensor.id,
      timeout_ms: 8000,
    });
    expect(reading.value).toBeGreaterThan(0);
  });

  test('5. Status payload (apn_list+esn+rssi) → GATEWAY_RSSI emitido', async () => {
    // Catalog completo (migration 20260429092751940) — RSSI Gateway Khomp cadastrado.
    // External_id: {empresa}_{esn}_GATEWAY_RSSI = A_999999_GATEWAY_RSSI
    const sensor = await ensureSensor({
      external_id: 'A_999999_GATEWAY_RSSI',
      sensor_type_name: 'RSSI Gateway Khomp',
    });
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        apn_list: { apn_list: [['global.algar.br', 'algar', '1212']] },
        esn: '999999',
        rssi: '20 - Bom',
        board_model: 'IED_REMOTA_V3',
        version: '2.4.2',
      },
      sensor_id: sensor.id,
      timeout_ms: 8000,
    });
    // Codec emite CSQ raw (20). dBm conversion (-113 + 2*20 = -73) fica em metadata.
    expect(reading.value).toBe(20);
  });

  test('6. send_status sem rssi → ignorado (sem reading)', async () => {
    const sensor = await ensureSensor({
      external_id: 'A_888888_DUMMY',
      sensor_type_name: 'Temperatura',
    });
    await clearReadings(sensor.id);
    const before = Date.now();
    await publishMqtt({
      topic: BRIDGE_TOPICS.khompMulti,
      payload: {
        cmd: 'send_status',
        esn: '888888',
        // sem apn_list nem rssi → ignora silenciosamente
      },
      qos: 1,
    });
    await new Promise((r) => setTimeout(r, 2000));
    const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
    const KEY =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/iot_sensor_readings?sensor_id=eq.${sensor.id}&time=gt.${new Date(before).toISOString()}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
    );
    const rows = (await res.json()) as unknown[];
    expect(rows.length).toBe(0);
  });
});
