import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';
import { waitForApp, navigateTo } from './helpers/navigation';

/**
 * Suite: Dashboard — smoke.
 *
 * Reduzido de 5 → 2 testes. Os 3 removidos validavam KPIs específicos
 * (MTTR, MTBF, preventiva/corretiva) — isso é regressão de feature do
 * widget, não smoke. Para smoke basta: dashboard renderiza E ao menos
 * 1 KPI core aparece (prova que o pipeline de dados está vivo).
 */

test.describe('Dashboard — smoke', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);
    await navigateTo(page, '/');
  });

  test('renderiza sem access denied', async ({ page }) => {
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('ao menos 1 KPI core (MTTR ou MTBF) renderiza', async ({ page }) => {
    // Aguarda spinners desaparecerem (poll-based, sem waitForTimeout).
    await page
      .waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 })
      .catch(() => {});

    const mttr = page.getByText(/MTTR/i).first();
    const mtbf = page.getByText(/MTBF/i).first();
    const hasMttr = await mttr.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasMtbf = await mtbf.isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasMttr || hasMtbf, 'nenhum KPI core renderizou — pipeline de dados pode estar quebrado').toBe(true);
  });
});
