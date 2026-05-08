import { test, expect, type Response } from '@playwright/test';

/**
 * Suite: Homolog login (Rede D'Or) — smoke.
 *
 * Reduzido. Removidos:
 *   - 3 categorias de warning não-assertivas (otherRls, schemaGaps, permFails).
 *     Eram informacionais, não smoke. Smoke deve falhar ou passar — sem ruído.
 *   - console.log de cada response (40+ linhas de debug).
 *   - listener requestfailed (debug-only).
 *
 * Mantido o único assert crítico: nenhum 4xx em /rest/v1/user_active_company.
 * Esse path é o regression test do bug align_has_global_access (migration
 * 20260430195952471) — se voltar, login do Daniel quebra inteiro.
 *
 * Skipped se HOMOLOG_DANIEL_EMAIL/PASSWORD ausentes.
 */

const EMAIL = process.env.HOMOLOG_DANIEL_EMAIL || '';
const PASSWORD = process.env.HOMOLOG_DANIEL_PASSWORD || '';
const HAS_CREDS = Boolean(EMAIL && PASSWORD);

test.describe("Homolog — login Rede D'Or (Daniel)", () => {
  test.skip(!HAS_CREDS, 'Defina HOMOLOG_DANIEL_EMAIL e HOMOLOG_DANIEL_PASSWORD');

  test('login → tenant resolve sem 4xx em user_active_company', async ({ page }) => {
    const failures: Array<{ url: string; status: number; body?: string }> = [];

    page.on('response', async (resp: Response) => {
      const url = resp.url();
      if (!/api\.[^/]+\.globalthings\.net\/(rest|functions)\//.test(url)) return;
      const status = resp.status();
      if (status < 400) return;
      let body: string | undefined;
      try {
        body = (await resp.text()).slice(0, 500);
      } catch {
        body = '<unreadable>';
      }
      failures.push({ url, status, body });
    });

    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    const passwordInput = page
      .locator('input[type="password"], input[name="password"], #password')
      .first();

    await expect(emailInput).toBeVisible({ timeout: 15_000 });
    await emailInput.fill(EMAIL);
    await passwordInput.fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();

    // Sai de /login = login OK (qualquer outra URL serve).
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

    // Cookie banner se aparecer (silencioso).
    await page
      .locator('button:has-text("Aceitar")')
      .first()
      .click({ timeout: 3_000 })
      .catch(() => {});

    // Único assert crítico: user_active_company sem 4xx.
    // É o alvo do regression test do bug align_has_global_access.
    const critical = failures.filter((f) => f.url.includes('/rest/v1/user_active_company'));
    if (critical.length > 0) {
      const detail = critical.map((f) => `  ${f.status} ${f.url}\n    ${f.body}`).join('\n');
      throw new Error(`Falhas em user_active_company:\n${detail}`);
    }

    expect(page.url(), 'login não saiu de /login').not.toMatch(/\/login/);
  });
});
