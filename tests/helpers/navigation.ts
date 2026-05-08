import { Page, expect } from '@playwright/test';

/**
 * Dismiss any tour/onboarding modals that may appear.
 */
async function dismissTour(page: Page): Promise<void> {
  // Try ALL possible dismiss buttons with force click (to bypass overlays)
  // Only match visible buttons/links INSIDE overlays, NOT sr-only skip-to-content links
  const overlay = page.locator('.fixed.inset-0, [class*="fixed inset-0"], [role="dialog"]');
  const overlayVisible = await overlay
    .first()
    .isVisible({ timeout: 2_000 })
    .catch(() => false);

  if (overlayVisible) {
    const dismissTexts = [
      /pular introdu|skip intro/i,
      /pular personaliza|skip personali/i,
      /pular tour|skip tour/i,
      /começar depois|start later/i,
      /fechar|close/i,
      /entendi|got it/i,
    ];

    for (const text of dismissTexts) {
      // Only look for buttons inside the overlay, not sr-only accessibility links
      const btn = overlay.locator('button, a:not(.sr-only)').filter({ hasText: text }).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click({ force: true });
        await page.waitForTimeout(800);
        return;
      }
    }
  }

  // Try the X (close) button on any fixed overlay (the onboarding wizard uses z-[100])
  const overlayClose = page
    .locator('.fixed.inset-0 button:has(svg), [class*="fixed inset-0"] button:has(svg)')
    .first();
  if (await overlayClose.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await overlayClose.click({ force: true });
    await page.waitForTimeout(500);
    return;
  }

  // Try the X (close) button on any dialog/modal
  const closeBtn = page.locator('[role="dialog"] button:has(svg)').first();
  if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeBtn.click({ force: true });
    await page.waitForTimeout(500);
  }
}

/**
 * Dismiss the LGPD consent banner if visible.
 */
async function dismissLGPD(page: Page): Promise<void> {
  // Accept or dismiss LGPD/cookie consent banner (fixed bottom bar)
  const acceptBtn = page
    .locator('.fixed.bottom-0 button')
    .filter({ hasText: /aceitar|accept|ok|concordo|agree/i })
    .first();
  if (await acceptBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await acceptBtn.click({ force: true });
    await page.waitForTimeout(400);
    return;
  }
  // Try any button in the bottom banner
  const bannerBtn = page.locator('.fixed.bottom-0 button').first();
  if (await bannerBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await bannerBtn.click({ force: true });
    await page.waitForTimeout(400);
  }
}

/**
 * Dismiss any open Radix dialog by pressing Escape.
 */
async function dismissOpenDialogs(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"][data-state="open"]').first();
  if (await dialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

/**
 * Wait for the app to fully load after login.
 * Handles company selection and tour dismissal automatically.
 */
export async function waitForApp(page: Page): Promise<void> {
  // Wait for the page to finish loading
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  // Handle company selection if needed
  await handleCompanySelection(page);

  // Wait a bit for React to render
  await page.waitForTimeout(1_000);

  // Dismiss any tour/onboarding modals
  await dismissTour(page);

  // Dismiss LGPD consent banner if visible
  await dismissLGPD(page);

  // Dismiss any open dialogs (e.g. segment onboarding)
  await dismissOpenDialogs(page);

  // Wait for loading spinners to disappear
  await page
    .waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 })
    .catch(() => {
      // Spinner may have already gone — that's fine
    });

  // Dismiss any overlay/modal that appeared
  const closeBtn = page.locator(
    'button:has-text("Fechar"), button:has-text("Pular"), button:has-text("Entendi"), button:has-text("OK"), button:has-text("Skip"), button[aria-label="Close"]'
  );
  if (
    await closeBtn
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await closeBtn.first().click();
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/**
 * Navigate to a path and wait for loading to finish.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1_000); // Allow React to render

  // Dismiss tour if it appears on the new page
  await dismissTour(page);

  // Dismiss any overlay/modal that appeared
  const closeBtn = page.locator(
    'button:has-text("Fechar"), button:has-text("Pular"), button:has-text("Entendi"), button:has-text("OK"), button:has-text("Skip"), button[aria-label="Close"]'
  );
  if (
    await closeBtn
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await closeBtn.first().click();
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/**
 * Wait for the company selection step and select the first company.
 * After login, users with multiple companies may see a company selector.
 */
export async function handleCompanySelection(page: Page): Promise<void> {
  const url = page.url();
  if (url.includes('/select-company')) {
    // Click the first company card/button
    const companyButton = page
      .locator('button, [role="button"], a')
      .filter({ hasText: /hospital|global|effort|company/i })
      .first();
    if (await companyButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await companyButton.click();
      await page.waitForURL('**/*', { timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    }
  }
}

/**
 * Assert that a button with specific text is visible on the page.
 */
export async function expectButtonVisible(page: Page, text: string | RegExp): Promise<void> {
  const button = page.getByRole('button', { name: text });
  await expect(button.first()).toBeVisible({ timeout: 5_000 });
}

/**
 * Assert that a button with specific text is NOT visible on the page.
 */
export async function expectButtonHidden(page: Page, text: string | RegExp): Promise<void> {
  const button = page.getByRole('button', { name: text });
  await expect(button)
    .toHaveCount(0, { timeout: 5_000 })
    .catch(async () => {
      // Button element exists but may be hidden
      await expect(button.first()).not.toBeVisible({ timeout: 2_000 });
    });
}

/**
 * Assert that a link with specific text is visible on the page.
 */
export async function expectLinkVisible(page: Page, text: string | RegExp): Promise<void> {
  const link = page.getByRole('link', { name: text });
  await expect(link.first()).toBeVisible({ timeout: 5_000 });
}

/**
 * Assert that a link with specific text is NOT visible on the page.
 */
export async function expectLinkHidden(page: Page, text: string | RegExp): Promise<void> {
  const link = page.getByRole('link', { name: text });
  await expect(link)
    .toHaveCount(0, { timeout: 5_000 })
    .catch(async () => {
      await expect(link.first()).not.toBeVisible({ timeout: 2_000 });
    });
}

/**
 * Safely click a save/submit button. Returns true if clicked, false if not found.
 * Prevents 6-minute timeouts from awaiting invisible buttons.
 */
export async function clickSave(page: Page): Promise<boolean> {
  const saveBtn = page
    .locator(
      'button[type="submit"], button:has-text("Salvar"), button:has-text("Save"), button:has-text("Criar"), button:has-text("Create"), button:has-text("Atualizar"), button:has-text("Update"), button:has-text("Confirmar"), button:has-text("Confirm")'
    )
    .first();

  // FormPageFooter only appears when form is dirty — check if visible
  let visible = await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false);

  if (!visible) {
    // Scroll to bottom to reveal sticky footer
    await page.keyboard.press('End');
    await page.waitForTimeout(500);
    visible = await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  }

  if (visible) {
    await saveBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Assert the page shows the Access Denied screen.
 */
export async function expectAccessDenied(page: Page): Promise<void> {
  // ProtectedRoute renders <ShieldX> icon and "Acesso Negado" / "Access Denied" text
  const denied = page.getByText(/acesso negado|access denied/i);
  await expect(denied.first()).toBeVisible({ timeout: 5_000 });
}

/**
 * Assert the page does NOT show the Access Denied screen.
 */
export async function expectNoAccessDenied(page: Page): Promise<void> {
  const denied = page.getByText(/acesso negado|access denied/i);
  await expect(denied).toHaveCount(0, { timeout: 3_000 });
}

/**
 * Check if an element matching a text pattern exists and is visible.
 * Returns true/false without throwing.
 */
export async function isVisible(page: Page, text: string | RegExp): Promise<boolean> {
  try {
    const el = page.getByText(text).first();
    return await el.isVisible({ timeout: 2_000 });
  } catch {
    return false;
  }
}
