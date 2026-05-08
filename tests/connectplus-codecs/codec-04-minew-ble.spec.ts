/**
 * minew_ble codec — Minew BLE gateway (G1/MG3/MG4/MG6).
 *
 * Topic: e2e/minew/A. External ID: '{MAC_UPPERCASE}:{sensor_name}'.
 * Cobertura inicial: MST01 (temperature+humidity).
 *
 * Variantes restantes (MHT, MTC*, MTL01, S1, S2, MTM02, MS*, C6, MTB02, MSH02)
 * em backlog — exigem amostras de payload reais (capturar via mosquitto_sub
 * em deploy Sabara/Rede D'Or).
 */

import { test, expect } from '@playwright/test';
import { BRIDGE_TOPICS, ensureSensor, publishAndWait } from './codec-helpers';
import { publishMqtt, clearReadings, waitForReading } from '../helpers/iot-context';

test.describe('Codec minew_ble', () => {
  test('1. MST01 temperature reading', async () => {
    const sensor = await ensureSensor({
      external_id: 'AABBCCDDEEFF:temperature',
      sensor_type_name: 'Temperatura',
    });
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.minew,
      payload: [
        {
          type: 'MST01',
          mac: 'AABBCCDDEEFF',
          temperature: 22.5,
          humidity: 60.0,
          rssi: -65,
        },
      ],
      sensor_id: sensor.id,
      expected_value: 22.5,
      timeout_ms: 8000,
    });
    expect(reading.value).toBe(22.5);
  });

  test('2. MST01 humidity emit em sensor separado', async () => {
    const tempSensor = await ensureSensor({
      external_id: 'AABBCCDDEEFF:temperature',
      sensor_type_name: 'Temperatura',
    });
    const humSensor = await ensureSensor({
      external_id: 'AABBCCDDEEFF:humidity',
      sensor_type_name: 'Umidade Relativa',
    });
    await clearReadings(tempSensor.id);
    await clearReadings(humSensor.id);

    await publishMqtt({
      topic: BRIDGE_TOPICS.minew,
      payload: [
        {
          type: 'MST01',
          mac: 'AABBCCDDEEFF',
          temperature: 18.2,
          humidity: 75.5,
        },
      ],
      qos: 1,
    });

    const tReading = await waitForReading(tempSensor.id, (r) => r.value === 18.2, {
      timeout_ms: 8000,
    });
    const hReading = await waitForReading(humSensor.id, (r) => r.value === 75.5, {
      timeout_ms: 8000,
    });
    expect(tReading.value).toBe(18.2);
    expect(hReading.value).toBe(75.5);
  });

  test.skip('3. Variantes MHT/MTC*/MTL01/etc — TODO: capturar payloads reais', async () => {
    // Cada variante tem shape distinto. Suite expandirá após captura via
    // mosquitto_sub em deploy production (Sabara, Rede D'Or).
  });
});
