/**
 * raw codec — passthrough de payload bytes/hex.
 *
 * Topic: e2e/raw/A. Sem transformação — emite reading com value direto.
 */

import { test, expect } from '@playwright/test';
import { BRIDGE_TOPICS } from './codec-helpers';
import { publishMqtt, clearReadings } from '../helpers/iot-context';

test.describe('Codec raw', () => {
  test.skip('1. raw passthrough — TODO: confirmar interface esperada', async () => {
    // raw codec espera formato específico não documentado.
    // Re-habilitar após inspecionar implementação em codecs/raw.py.
  });
});
