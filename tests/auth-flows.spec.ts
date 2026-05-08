import { test, expect } from '@playwright/test';

/**
 * Suite: Authentication Flows
 *
 * Tests login page, error handling, forgot-password, signup navigation.
 * These tests run WITHOUT authentication (unauthenticated user).
 */

test.describe('Authentication Flows', () => {
  test('should show login page with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Should have email and password inputs
    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    const passwordInput = page
      .locator('input[type="password"], input[name="password"], #password')
      .first();

    await expect(emailInput).toBeVisible({ timeout: 10_000 });
    await expect(passwordInput).toBeVisible({ timeout: 5_000 });
  });

  test('should show error on invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    const passwordInput = page
      .locator('input[type="password"], input[name="password"], #password')
      .first();

    await emailInput.fill('invalid@test.com');
    await passwordInput.fill('wrongpassword123');

    const submitBtn = page.locator('button[type="submit"]').first();
    await submitBtn.click();

    // Should show an error message (toast, alert, or inline)
    const error = page
      .locator('[role="alert"], [data-sonner-toast], .text-destructive, .text-red-500')
      .first();
    await expect(error).toBeVisible({ timeout: 10_000 });
  });

  test('should have a link to forgot password page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const forgotLink = page.locator('a[href*="forgot-password"]').first();
    await expect(forgotLink).toBeVisible({ timeout: 5_000 });
  });

  test('should navigate to forgot password page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const forgotLink = page.locator('a[href*="forgot-password"]').first();
    await forgotLink.click();

    await expect(page).toHaveURL(/forgot-password/, { timeout: 10_000 });
  });

  // GT ONE is enterprise (invite-only) — no public signup page exists

  test('forgot password page has email input and back link', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
    await expect(emailInput).toBeVisible({ timeout: 10_000 });

    // Should have a link back to login
    const backLink = page.locator('a[href*="login"]').first();
    await expect(backLink).toBeVisible({ timeout: 5_000 });
  });
});
