import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS, HAS_MULTI_ROLE_USERS } from './helpers/auth';
import { waitForApp, navigateTo, expectNoAccessDenied } from './helpers/navigation';

/**
 * Suite: Basic Permission Tests by Role
 *
 * Uses REAL UI labels: "Novo Ativo" (assets), "Nova OS" (WOs)
 * Routes: /assets, /os (not /work-orders), /employees
 */

// Helper: check if a button/link with text is visible
async function hasAction(page: any, text: string | RegExp): Promise<boolean> {
  const el = page.getByRole('button', { name: text }).or(page.getByRole('link', { name: text }));
  try {
    return (await el.count()) > 0 && (await el.first().isVisible({ timeout: 2_000 }));
  } catch {
    return false;
  }
}

// Helper: wait for page list content to load (proves data + permissions loaded)
async function waitForListContent(page: any) {
  const rows = page.locator('table tbody tr, .card, [class*="empty"]');
  await rows
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => {});
  // Extra wait for permission gate to re-render after permissions load
  await page.waitForTimeout(3_000);
}

// Helper: check if a button/link is visible AFTER permissions have loaded
async function hasActionAfterLoad(page: any, text: string | RegExp): Promise<boolean> {
  await waitForListContent(page);
  const el = page
    .locator('main')
    .getByRole('button', { name: text })
    .or(page.locator('main').getByRole('link', { name: text }));
  try {
    return (await el.count()) > 0 && (await el.first().isVisible({ timeout: 2_000 }));
  } catch {
    return false;
  }
}

// --- Owner: full access ---
test.describe('Owner permissions', () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner.email);
    await waitForApp(page);
  });

  test('can see "Novo Ativo" on Assets page', async ({ page }) => {
    await navigateTo(page, '/assets');
    expect(await hasAction(page, /novo ativo/i)).toBe(true);
  });

  test('can see "Nova OS" on Work Orders page at /os', async ({ page }) => {
    await navigateTo(page, '/os');
    expect(await hasAction(page, /nova os/i)).toBe(true);
  });

  test('can see create button on Employees page', async ({ page }) => {
    await navigateTo(page, '/employees');
    expect(await hasAction(page, /convidar usu|novo colaborador/i)).toBe(true);
  });

  test('can access Settings > Users', async ({ page }) => {
    await navigateTo(page, '/settings/users');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });
});

// --- Admin: same as owner within company ---
test.describe('Admin permissions', () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);
  });

  test('can see "Novo Ativo" on Assets page', async ({ page }) => {
    await navigateTo(page, '/assets');
    expect(await hasAction(page, /novo ativo/i)).toBe(true);
  });

  test('can see "Nova OS" on Work Orders page at /os', async ({ page }) => {
    await navigateTo(page, '/os');
    expect(await hasAction(page, /nova os/i)).toBe(true);
  });

  test('can see create button on Employees page', async ({ page }) => {
    await navigateTo(page, '/employees');
    expect(await hasAction(page, /convidar usu|novo colaborador/i)).toBe(true);
  });

  test('can access Settings > Users', async ({ page }) => {
    await navigateTo(page, '/settings/users');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });
});

// --- Manager: most actions, no settings edit ---
test.describe('Manager permissions', () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.manager.email);
    await waitForApp(page);
  });

  test('can see "Novo Ativo" on Assets page', async ({ page }) => {
    await navigateTo(page, '/assets');
    expect(await hasAction(page, /novo ativo/i)).toBe(true);
  });

  test('can see "Nova OS" on Work Orders page at /os', async ({ page }) => {
    await navigateTo(page, '/os');
    expect(await hasAction(page, /nova os/i)).toBe(true);
  });

  test('can access Employees page (view)', async ({ page }) => {
    await navigateTo(page, '/employees');
    await expectNoAccessDenied(page);
    // Manager has employees.view + edit but NOT employees.create
    // So the page loads but "Novo Colaborador" button may not appear
    const content = page.locator('table, h1, h2, [class*="empty"]').first();
    await expect(content).toBeVisible({ timeout: 10_000 });
  });

  test('cannot access Settings > Users', async ({ page }) => {
    await navigateTo(page, '/settings/users');
    const denied = page.getByText(/acesso negado|access denied/i);
    const hasDenied = await denied.count().catch(() => 0);
    if (!hasDenied) {
      expect(page.url()).not.toContain('/settings/users');
    }
  });
});

// --- Technician: limited create, no delete ---
test.describe('Technician permissions', () => {
  test.skip(!HAS_MULTI_ROLE_USERS, 'Skipped: no separate viewer/technician user configured');
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.technician.email);
    await waitForApp(page);
  });

  test('cannot see "Novo Ativo"" on Assets page', async ({ page }) => {
    await navigateTo(page, '/assets');
    expect(await hasActionAfterLoad(page, /novo ativo/i)).toBe(false);
  });

  test('cannot see "Nova OS" on Work Orders page (no create permission)', async ({ page }) => {
    await navigateTo(page, '/os');
    expect(await hasActionAfterLoad(page, /nova os/i)).toBe(false);
  });

  test('cannot see create button on Employees page', async ({ page }) => {
    await navigateTo(page, '/employees');
    expect(await hasActionAfterLoad(page, /novo colaborador/i)).toBe(false);
  });

  test('can view assets page without access denied', async ({ page }) => {
    await navigateTo(page, '/assets');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });
});

// --- Viewer: read only ---
test.describe('Viewer permissions', () => {
  test.skip(!HAS_MULTI_ROLE_USERS, 'Skipped: no separate viewer user configured');
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.viewer.email);
    await waitForApp(page);
  });

  test('cannot see "Novo Ativo"" on Assets page', async ({ page }) => {
    await navigateTo(page, '/assets');
    expect(await hasActionAfterLoad(page, /novo ativo/i)).toBe(false);
  });

  test('cannot see "Nova OS"" on Work Orders page at /os', async ({ page }) => {
    await navigateTo(page, '/os');
    expect(await hasActionAfterLoad(page, /nova os/i)).toBe(false);
  });

  test('cannot see create button on Employees page', async ({ page }) => {
    await navigateTo(page, '/employees');
    expect(await hasActionAfterLoad(page, /convidar usu|novo colaborador/i)).toBe(false);
  });

  test('can view assets page (read only)', async ({ page }) => {
    await navigateTo(page, '/assets');
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });
});
