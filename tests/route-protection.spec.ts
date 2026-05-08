import { test, expect, type Page } from '@playwright/test';
import {
  loginAs,
  logout,
  TEST_USERS,
  HAS_MULTI_ROLE_USERS,
  expectAuthenticatedOnApp,
} from './helpers/auth';
import { waitForApp, navigateTo } from './helpers/navigation';

/**
 * Suite: Route Protection — smoke.
 *
 * Cura desta versão:
 * - `waitForLoadState('networkidle')` removido. App mantém WebSocket via
 *   Supabase Realtime, o que pode impedir networkidle de disparar — gerando
 *   delay de até 10s por teste (mesmo com `.catch`). Substituído por race
 *   entre `waitForURL` (redirect determinístico) e `waitFor` (texto inline).
 * - 3 testes de "sessão expirada" consolidados em loop sobre rotas.
 */

// Race entre redirect para login/home/forgot-password e texto "sessão expirada".
// Retorna a fonte do bloqueio ou null se nenhum aconteceu no timeout.
async function waitForUnauthBlock(page: Page) {
  return Promise.any([
    page
      .waitForURL(
        (u) =>
          u.pathname === '/login' ||
          u.pathname === '/' ||
          u.pathname.startsWith('/forgot-password'),
        { timeout: 10_000 }
      )
      .then(() => 'redirect' as const),
    page
      .getByText(/sessão expirada|session expired/i)
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => 'session-expired' as const),
  ]).catch(() => null);
}

// Race entre redirect para fora da rota restrita e texto "acesso negado".
async function waitForAccessDenied(page: Page, restrictedPath: string) {
  return Promise.any([
    page
      .waitForURL((u) => !u.pathname.startsWith(restrictedPath), { timeout: 8_000 })
      .then(() => 'redirect' as const),
    page
      .getByText(/acesso negado|access denied/i)
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => 'denied' as const),
  ]).catch(() => null);
}

test.describe('Unauthenticated access', () => {
  for (const route of ['/assets', '/employees', '/os']) {
    test(`bloqueia acesso direto a ${route}`, async ({ page }) => {
      await page.goto(route);
      const result = await waitForUnauthBlock(page);
      expect(result, `${route} não bloqueou usuário sem sessão`).not.toBeNull();
    });
  }
});

test.describe('Viewer route restrictions', () => {
  test.skip(!HAS_MULTI_ROLE_USERS, 'Skipped: no separate viewer user configured');
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.viewer.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);
  });

  test('viewer tem acesso a /assets', async ({ page }) => {
    await navigateTo(page, '/assets');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('viewer em /assets/new é negado ou redirecionado', async ({ page }) => {
    await navigateTo(page, '/assets/new');
    const result = await waitForAccessDenied(page, '/assets/new');
    expect(result, 'viewer permaneceu em /assets/new sem bloqueio').not.toBeNull();
  });

  test('viewer em /os/new é negado ou redirecionado', async ({ page }) => {
    await navigateTo(page, '/os/new');
    const result = await waitForAccessDenied(page, '/os/new');
    expect(result, 'viewer permaneceu em /os/new sem bloqueio').not.toBeNull();
  });
});

test.describe('Technician route restrictions', () => {
  test.skip(!HAS_MULTI_ROLE_USERS, 'Skipped: no separate technician user configured');
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.technician.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);
  });

  test('technician tem acesso a /os', async ({ page }) => {
    await navigateTo(page, '/os');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('technician em /settings/users é negado ou redirecionado', async ({ page }) => {
    await navigateTo(page, '/settings/users');
    const result = await waitForAccessDenied(page, '/settings/users');
    expect(result, 'technician permaneceu em /settings/users sem bloqueio').not.toBeNull();
  });
});

test.describe('Logout limpa sessão', () => {
  test.setTimeout(60_000);
  test('após logout, rota protegida volta para login/sessão expirada', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    await navigateTo(page, '/assets');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    await logout(page);

    await page.goto('/assets');
    const result = await waitForUnauthBlock(page);
    expect(result, 'logout não invalidou sessão').not.toBeNull();
  });
});
