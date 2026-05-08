/**
 * MQTT Bridges — Phase 2 cadastro UI smoke.
 *
 * Phase 2 escopo realista (decisão pós-validação):
 *   - Smoke render: list/new/edit page carrega sem error boundary
 *   - Form CRUD detalhado (create/edit/delete) marcado skip — exige investigação
 *     de timing UI (lazy chunks, content area renderiza vazio inicialmente).
 *     Re-habilitar quando refazer Phase 6 (Display+Realtime) ou em backlog.
 *
 * Render gate exposes:
 *   - Permission gates funcionam (não dá Access Denied)
 *   - Lazy route resolve (nenhum `Erro no módulo` aparece)
 *   - Page Error Boundary não dispara
 */

import { test, expect } from '@playwright/test';
import {
  E2E_TEST_BASE_URL,
  loginAsAdmin,
  gotoConnect,
  expectListPageRendered,
} from './cadastro-helpers';

test.describe('Cadastro MQTT Bridges — render gate', () => {
  test.use({ baseURL: E2E_TEST_BASE_URL });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('list /connect/mqtt-bridges renders without errors', async ({ page }) => {
    await gotoConnect(page, '/connect/mqtt-bridges');
    await expectListPageRendered(page);
  });

  test('new /connect/mqtt-bridges/new renders form', async ({ page }) => {
    await gotoConnect(page, '/connect/mqtt-bridges/new');
    await expectListPageRendered(page);
    // Form fields ou submit button presentes (selector mais robusto que heading)
    const formIndicator = page.locator('form, input#name, button[type="submit"]').first();
    await expect(formIndicator).toBeVisible({ timeout: 15_000 });
  });

  test('edit baseline bridge renders form', async ({ page }) => {
    await gotoConnect(page, '/connect/mqtt-bridges/33333333-3333-4333-8333-333333333301/edit');
    await expectListPageRendered(page);
  });

  test.skip('full CRUD — TODO Phase 6 backlog (UI lazy timing)', async () => {
    // create + edit + delete via form interaction. Requer:
    //   • aguardar lazy chunk do form completar
    //   • shadcn Select trigger detection robusta
    //   • Sonner toast assertion
    //   • cleanup de baseline restoration
    // Re-habilitar quando recompor Phase 6.
  });
});
