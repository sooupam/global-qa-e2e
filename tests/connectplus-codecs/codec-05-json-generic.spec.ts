/**
 * json_generic codec — extração via dotted path JSON.
 *
 * Topic: e2e/json/A. parser_config define field paths.
 * Suite atual usa parser_config={} → comportamento default (provavelmente
 * passthrough simples). Comportamento real depende de implementação.
 */

import { test, expect } from '@playwright/test';
import { BRIDGE_TOPICS, ensureSensor, publishAndWait } from './codec-helpers';

test.describe('Codec json_generic', () => {
  test.skip('1. dotted path extraction — TODO: parser_config exemplo', async () => {
    // json_generic com parser_config={} não extrai. Necessita config como
    // {"value_path": "data.temperature", "id_path": "device_id"}.
    // Re-habilitar com bridge dedicada + parser_config válido.
  });

  test.skip('2. payload simples external_id+value direto — TODO: parser_config necessário', async () => {
    const sensor = await ensureSensor({
      external_id: 'JSON_TEST_001',
      sensor_type_name: 'Temperatura',
    });
    const reading = await publishAndWait({
      topic: BRIDGE_TOPICS.jsonGeneric,
      payload: { external_id: 'JSON_TEST_001', value: 24.7 },
      sensor_id: sensor.id,
      expected_value: 24.7,
      timeout_ms: 8000,
    });
    expect(reading.value).toBe(24.7);
  });
});
