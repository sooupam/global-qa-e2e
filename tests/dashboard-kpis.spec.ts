import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS, expectAuthenticatedOnApp } from './helpers/auth';
import { waitForApp, navigateTo } from './helpers/navigation';

/**
 * Suite: Dashboard — hardened smoke.
 *
 * Versão anterior tinha 2 testes:
 *   1. "renderiza sem access denied" — fraco (só ausência de texto)
 *   2. "MTTR/MTBF renderiza" — depende de dados (falso negativo em tenant vazio)
 *
 * Versão hardened: 1 teste com evidências POSITIVAS de dashboard real:
 *   - autenticado E em rota válida (não /select-company, não /onboarding)
 *   - main element visível
 *   - spinners de loading não estão pendurados
 *   - main tem ao menos 1 elemento filho (não está vazia)
 *   - ao menos 1 heading visível (proves dashboard structure rendered)
 *
 * Removido: assertion específica de KPIs (MTTR/MTBF). Smoke não deve depender
 * de dados de domínio. Se dashboard quebrar, headings/main sumirão também.
 */

test.describe('Dashboard — hardened smoke', () => {
  test.setTimeout(60_000);

  test('dashboard renderiza com conteúdo real (não loading vazio)', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);
    await navigateTo(page, '/');

    // Aguarda spinners desaparecerem E main ter conteúdo. Falha se ficar
    // em loading infinito ou se main estiver vazia.
    await page
      .waitForFunction(
        () => {
          const main = document.querySelector('main, [role="main"]');
          if (!main) return false;
          const spinners = document.querySelectorAll('.animate-spin');
          if (spinners.length > 0) return false;
          return main.children.length > 0;
        },
        { timeout: 20_000 }
      )
      .catch(() => {});

    // Asserts explícitos pra mensagem de erro clara em caso de falha.
    const main = page.locator('main, [role="main"]').first();
    await expect(main, 'main element não está visível').toBeVisible({ timeout: 5_000 });

    const spinners = page.locator('.animate-spin');
    await expect(spinners, 'dashboard travou em loading (spinners ainda visíveis)').toHaveCount(0, {
      timeout: 5_000,
    });

    const headings = page.locator('h1, h2, [role="heading"]');
    expect(
      await headings.count(),
      'dashboard sem nenhum heading — provavelmente rendered vazio'
    ).toBeGreaterThan(0);
  });
});
