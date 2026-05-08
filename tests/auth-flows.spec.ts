import { test, expect } from '@playwright/test';

/**
 * Suite: Auth flows — smoke.
 *
 * Reduzido de 5 → 2 testes. Os 3 removidos validavam UI cosmética da
 * tela de forgot-password (link visível, navegação, input renderiza).
 * Isso é regressão de UI, não smoke. Smoke real:
 *  1. Tela de login renderiza com campos email+senha (CDN ok, bundle ok).
 *  2. Credenciais inválidas retornam erro visível (auth provider responde).
 *
 * Roda sem auth (usuário anônimo).
 */

test.describe('Auth — smoke', () => {
  test('login page renderiza com campos email + senha', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    const passwordInput = page
      .locator('input[type="password"], input[name="password"], #password')
      .first();

    await expect(emailInput).toBeVisible({ timeout: 10_000 });
    await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  });

  test('credenciais inválidas exibem erro visível', async ({ page }) => {
    await page.goto('/login');

    await page
      .locator('input[type="email"], input[name="email"], #email')
      .first()
      .fill('invalid@smoke-test.local');
    await page
      .locator('input[type="password"], input[name="password"], #password')
      .first()
      .fill('wrong-password-smoke');

    await page.locator('button[type="submit"]').first().click();

    const error = page
      .locator('[role="alert"], [data-sonner-toast], .text-destructive, .text-red-500')
      .first();
    await expect(error, 'auth provider não respondeu com erro visível').toBeVisible({
      timeout: 10_000,
    });
  });
});
