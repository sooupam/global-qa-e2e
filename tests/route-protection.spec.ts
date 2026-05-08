import { test, expect } from '@playwright/test';
import { loginAs, logout, TEST_USERS, HAS_MULTI_ROLE_USERS } from './helpers/auth';
import { waitForApp, navigateTo } from './helpers/navigation';

/**
 * Suite: Route Protection.
 *
 * Cura: 5 `waitForTimeout` removidos.
 * Substituídos por `waitForLoadState('networkidle')` ou pela própria poll
 * automática do `expect().toHaveCount/toBeVisible` (auto-retry).
 */

test.describe('Unauthenticated access', () => {
  for (const route of ['/assets', '/employees', '/os']) {
    test(`bloqueia acesso direto a ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      const sessionExpired = page.getByText(/sessão expirada|session expired/i);
      const isExpired = await sessionExpired
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      const isRedirected = page.url().includes('/login') || page.url().endsWith('/');
      expect(isExpired || isRedirected, `${route} não bloqueou usuário sem sessão`).toBe(true);
    });
  }
});

test.describe('Viewer route restrictions', () => {
  test.skip(!HAS_MULTI_ROLE_USERS, 'Skipped: no separate viewer user configured');
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.viewer.email);
    await waitForApp(page);
  });

  test('viewer tem acesso a /assets', async ({ page }) => {
    await navigateTo(page, '/assets');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('viewer em /assets/new é negado ou redirecionado', async ({ page }) => {
    await navigateTo(page, '/assets');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await navigateTo(page, '/assets/new');
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    const denied = page.getByText(/acesso negado|access denied/i);
    const url = page.url();
    expect(
      (await denied.count()) > 0 || !url.includes('/assets/new'),
      'viewer permaneceu em /assets/new sem mensagem de acesso negado'
    ).toBe(true);
  });

  test('viewer em /os/new é negado ou redirecionado', async ({ page }) => {
    await navigateTo(page, '/os');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    await navigateTo(page, '/os/new');
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    const denied = page.getByText(/acesso negado|access denied/i);
    const url = page.url();
    expect(
      (await denied.count()) > 0 || !url.includes('/os/new'),
      'viewer permaneceu em /os/new sem mensagem de acesso negado'
    ).toBe(true);
  });
});

test.describe('Technician route restrictions', () => {
  test.skip(!HAS_MULTI_ROLE_USERS, 'Skipped: no separate technician user configured');
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.technician.email);
    await waitForApp(page);
  });

  test('technician tem acesso a /os', async ({ page }) => {
    await navigateTo(page, '/os');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('technician em /settings/users é negado ou redirecionado', async ({ page }) => {
    await navigateTo(page, '/settings/users');
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    const denied = page.getByText(/acesso negado|access denied/i);
    const url = page.url();
    expect(
      (await denied.count()) > 0 || !url.includes('/settings/users'),
      'technician permaneceu em /settings/users sem mensagem de acesso negado'
    ).toBe(true);
  });
});

test.describe('Logout limpa sessão', () => {
  test.setTimeout(60_000);
  test('após logout, rota protegida volta para login/sessão expirada', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);

    await navigateTo(page, '/assets');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    await logout(page);

    await page.goto('/assets');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const sessionExpiredOrLogin =
      page.url().includes('/login') ||
      page.url().endsWith('/') ||
      (await page.getByText(/sessão expirada|session expired/i).count()) > 0;
    expect(sessionExpiredOrLogin, 'logout não invalidou sessão').toBe(true);
  });
});
