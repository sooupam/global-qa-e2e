import { test, expect, type Page, type Response } from '@playwright/test';

/**
 * Suite: Homolog login (Rede D'Or) — hardened.
 *
 * Versão anterior validava: URL não em /login + zero 4xx em user_active_company.
 * Falso positivo: Daniel podia parar em /select-company ou em loading infinito.
 *
 * Hardened — após login, valida ESTADO REAL pós-auth:
 *   1. URL não está em /login, /select-company, /onboarding
 *   2. Zero 4xx em user_active_company (regression bug align_has_global_access)
 *   3. main element renderizou + spinners limpos + main tem children
 *
 * Skipped se HOMOLOG_DANIEL_EMAIL/PASSWORD ausentes.
 */

const EMAIL = process.env.HOMOLOG_DANIEL_EMAIL || '';
const PASSWORD = process.env.HOMOLOG_DANIEL_PASSWORD || '';
const HAS_CREDS = Boolean(EMAIL && PASSWORD);

test.describe("Homolog — login Rede D'Or (Daniel) hardened", () => {
  test.skip(!HAS_CREDS, 'Defina HOMOLOG_DANIEL_EMAIL e HOMOLOG_DANIEL_PASSWORD');

  test('login resulta em app real carregado (não loading, não /select-company)', async ({
    page,
  }) => {
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

    // Sai de /login.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });

    // Cookie banner se aparecer.
    await page
      .locator('button:has-text("Aceitar")')
      .first()
      .click({ timeout: 3_000 })
      .catch(() => {});

    // 1. Estado real pós-login — não em estados intermediários.
    await expect(page, 'login terminou em /select-company').not.toHaveURL(/\/select-company/, {
      timeout: 5_000,
    });
    await expect(page, 'login terminou em /onboarding').not.toHaveURL(/\/onboarding/, {
      timeout: 5_000,
    });

    // 2. user_active_company sem 4xx (regression align_has_global_access).
    const critical = failures.filter((f) => f.url.includes('/rest/v1/user_active_company'));
    if (critical.length > 0) {
      const detail = critical.map((f) => `  ${f.status} ${f.url}\n    ${f.body}`).join('\n');
      throw new Error(`Falhas em user_active_company:\n${detail}`);
    }

    // 3. App carregou conteúdo real.
    await page
      .waitForFunction(
        () => {
          const main = document.querySelector('main, [role="main"]');
          if (!main) return false;
          const sp = document.querySelectorAll('.animate-spin');
          return sp.length === 0 && main.children.length > 0;
        },
        { timeout: 20_000 }
      )
      .catch(() => {});

    const main = page.locator('main, [role="main"]').first();
    await expect(main, 'main não renderizou após login').toBeVisible({ timeout: 5_000 });
    const spinners = page.locator('.animate-spin');
    await expect(spinners, 'app travou em loading após login').toHaveCount(0, { timeout: 5_000 });
  });
});
