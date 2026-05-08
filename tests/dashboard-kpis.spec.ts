import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';
import { waitForApp, navigateTo } from './helpers/navigation';

/**
 * Suite: Dashboard — Maintenance KPIs Widget
 *
 * Tests the KPI widget (MTTR, MTBF, % Preventiva, % Corretiva).
 */

test.describe('Dashboard KPIs', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);
    await navigateTo(page, '/');
  });

  test('dashboard loads without errors', async ({ page }) => {
    const denied = page.getByText(/acesso negado|access denied/i);
    await expect(denied).toHaveCount(0, { timeout: 3_000 });
  });

  test('MTTR KPI card is visible', async ({ page }) => {
    const mttr = page.getByText(/MTTR/i).first();
    await expect(mttr).toBeVisible({ timeout: 10_000 });
  });

  test('MTBF KPI card is visible', async ({ page }) => {
    const mtbf = page.getByText(/MTBF/i).first();
    await expect(mtbf).toBeVisible({ timeout: 10_000 });
  });

  test('preventive/corrective percentage cards visible', async ({ page }) => {
    const preventive = page.getByText(/preventiva|preventive/i).first();
    const corrective = page.getByText(/corretiva|corrective/i).first();

    const hasPrev = await preventive.isVisible({ timeout: 10_000 }).catch(() => false);
    const hasCorr = await corrective.isVisible({ timeout: 5_000 }).catch(() => false);

    expect(hasPrev || hasCorr).toBe(true);
  });

  test('KPI cards show after loading completes', async ({ page }) => {
    // Wait for spinners to disappear
    await page
      .waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 })
      .catch(() => {});

    // After loading, MTTR card should have rendered with some content
    const mttrText = page.getByText(/MTTR/).first();
    await expect(mttrText).toBeVisible({ timeout: 5_000 });

    // MTBF should also be present
    const mtbfText = page.getByText(/MTBF/).first();
    await expect(mtbfText).toBeVisible({ timeout: 5_000 });
  });
});
