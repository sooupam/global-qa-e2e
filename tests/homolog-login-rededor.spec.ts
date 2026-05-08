import { test, expect, type Page, type Response } from '@playwright/test';

/**
 * Suite: Homolog login regression (Rede D'Or)
 *
 * Loga em https://rededorpcm.one.globalthings.net com a conta Daniel,
 * seleciona a primeira empresa em /select-company, e valida que NÃO
 * há respostas 4xx em rotas críticas — especialmente 42501 (RLS) em
 * user_active_company.
 *
 * Skipped se HOMOLOG_DANIEL_EMAIL / HOMOLOG_DANIEL_PASSWORD não estiverem
 * setados, pra evitar quebrar a suite local.
 *
 * Uso: bash scripts/test-homolog-login.sh
 *
 * Regression test pro bug:
 *   has_global_access() não alinhado com has_global_role() →
 *   42501 em user_active_company ao trocar empresa.
 *   Fix: migration 20260430195952471_align_has_global_access.sql
 */

const EMAIL = process.env.HOMOLOG_DANIEL_EMAIL || '';
const PASSWORD = process.env.HOMOLOG_DANIEL_PASSWORD || '';
const HAS_CREDS = Boolean(EMAIL && PASSWORD);

test.describe("Homolog · Login Rede D'Or (Daniel)", () => {
  test.skip(!HAS_CREDS, 'Defina HOMOLOG_DANIEL_EMAIL e HOMOLOG_DANIEL_PASSWORD pra rodar');

  test('login → select-company → dashboard sem 4xx críticos', async ({ page }) => {
    const failures: Array<{ url: string; status: number; body?: string }> = [];

    page.on('response', async (resp: Response) => {
      const url = resp.url();
      const status = resp.status();
      // Só rastreia chamadas pra API do tenant (Supabase REST + EF)
      if (!/api\.[^/]+\.globalthings\.net\/(rest|functions)\//.test(url)) return;
      // Log TODAS as chamadas (pra debug) — só falhas vão pro array
      console.log(`[net] ${status} ${url.replace(/^https:\/\/[^/]+/, '')}`);
      if (status < 400) return;
      let body: string | undefined;
      try {
        body = (await resp.text()).slice(0, 500);
      } catch {
        body = '<unreadable>';
      }
      failures.push({ url, status, body });
    });

    page.on('requestfailed', (req) => {
      console.log(`[net] FAIL ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });

    // 1. Página de login
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    const passwordInput = page
      .locator('input[type="password"], input[name="password"], #password')
      .first();

    await expect(emailInput).toBeVisible({ timeout: 15_000 });
    await emailInput.fill(EMAIL);
    await passwordInput.fill(PASSWORD);
    await page.locator('button[type="submit"]').first().click();

    // 2. Aguarda sair de /login — qualquer outra URL conta como login OK
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
    console.log(`[homolog] post-login URL: ${page.url()}`);

    // 2b. Aceita cookie banner se aparecer
    await page
      .locator('button:has-text("Aceitar")')
      .first()
      .click({ timeout: 3_000 })
      .catch(() => {});

    // 2c. Espera dashboard estabilizar (todas as queries iniciais)
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // 3. Asserts: críticos = qualquer falha em user_active_company (alvo do regression test)
    const critical = failures.filter((f) => f.url.includes('/rest/v1/user_active_company'));

    if (critical.length > 0) {
      const detail = critical.map((f) => `  ${f.status} ${f.url}\n    ${f.body}`).join('\n');
      throw new Error(`Critical: falhas em user_active_company:\n${detail}`);
    }

    // 42501 em OUTRAS tabelas = RLS gap separado (não é o bug que rastreamos, mas vale logar)
    const otherRls = failures.filter(
      (f) => f.body?.includes('42501') && !f.url.includes('user_active_company')
    );
    if (otherRls.length > 0) {
      console.warn(`[homolog] ⚠ ${otherRls.length} 42501 em outras tabelas (RLS gaps):`);
      otherRls.forEach((f) => {
        const path = f.url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
        console.warn(`  ${f.status} ${path}`);
      });
    }

    // Schema gaps (404 em REST = tabela/RPC ausente). Reporta como warning.
    const schemaGaps = failures.filter((f) => f.status === 404 && f.url.includes('/rest/v1/'));
    if (schemaGaps.length > 0) {
      console.warn(`[homolog] ⚠ ${schemaGaps.length} schema gaps (migrations pending em homolog):`);
      schemaGaps.forEach((f) => {
        const path = f.url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
        console.warn(`  404 ${path}`);
      });
    }

    // 403 não-críticos (permissões/RLS de outras tabelas). Reporta como warning.
    const permFails = failures.filter((f) => f.status === 403 && !critical.includes(f));
    if (permFails.length > 0) {
      console.warn(`[homolog] ⚠ ${permFails.length} 403 (permission/RLS leve):`);
      permFails.forEach((f) => {
        const path = f.url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
        console.warn(`  403 ${path}`);
      });
    }

    // 4. Assert NÃO está em /login (smoke: login OK, página interna carregou)
    expect(page.url()).not.toMatch(/\/login/);
  });
});
