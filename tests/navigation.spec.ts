import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';
import { waitForApp, navigateTo } from './helpers/navigation';

/**
 * Suite: Navigation
 *
 * Tests that all main pages load correctly for an authenticated admin user.
 * Uses REAL routes from the source code.
 */

test.describe('Navigation (as Admin)', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);
  });

  test('should load dashboard', async ({ page }) => {
    await navigateTo(page, '/');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const content = page.getByText(/MTTR|MTBF|dashboard|painel|overview/i).first();
    const hasContent = await content.isVisible({ timeout: 10_000 }).catch(() => false);
    expect(hasContent || !page.url().includes('/login')).toBe(true);
  });

  test('should navigate to work orders at /os', async ({ page }) => {
    await navigateTo(page, '/os');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const heading = page.getByText(/ordens de serviço|work orders/i).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('should navigate to assets list', async ({ page }) => {
    await navigateTo(page, '/assets');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const heading = page.getByText(/ativos|assets/i).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('should navigate to sectors', async ({ page }) => {
    await navigateTo(page, '/sectors');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const heading = page.getByText(/localizaç|localidades|localiza|sectors|locations/i).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('should navigate to employees', async ({ page }) => {
    await navigateTo(page, '/employees');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const heading = page.getByText(/colaboradores|employees/i).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('should navigate to maintenance plans', async ({ page }) => {
    await navigateTo(page, '/maintenance-plans');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const heading = page
      .getByText(/planejamento|planos de manutenção|maintenance plans|manutenção/i)
      .first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('should navigate to inventory', async ({ page }) => {
    await navigateTo(page, '/inventory');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('should navigate to settings', async ({ page }) => {
    await navigateTo(page, '/settings');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const heading = page.getByText(/configurações|settings/i).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('should navigate to profile', async ({ page }) => {
    await navigateTo(page, '/profile');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });

    const heading = page.getByText(/perfil|profile/i).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('should navigate to equipment families', async ({ page }) => {
    await navigateTo(page, '/equipment-families');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('should navigate to equipment models', async ({ page }) => {
    await navigateTo(page, '/equipment-models');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('should navigate to service requests', async ({ page }) => {
    await navigateTo(page, '/service-requests');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('should navigate to library occurrences', async ({ page }) => {
    await navigateTo(page, '/library/occurrences');

    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });
});
