import { Page } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const DEFAULT_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';

// Storage key must match the tenant-aware key used by the Supabase client.
// In E2E we default to the SDK's standard key (no tenant slug in localhost).
// Override via E2E_TENANT_SLUG env var when testing tenant-specific flows.
const TENANT_SLUG = process.env.E2E_TENANT_SLUG || null;
const STORAGE_KEY = TENANT_SLUG
  ? `sb-auth-${TENANT_SLUG}`
  : `sb-${new URL(SUPABASE_URL).hostname}-auth-token`;

export interface TestUser {
  email: string;
  role: string;
  name: string;
}

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';

/**
 * Whether we have multiple test users with different roles.
 * Set to true now that viewer, technician, and manager users exist.
 */
export const HAS_MULTI_ROLE_USERS = true;

export const TEST_USERS = {
  owner: { email: ADMIN_EMAIL, role: 'owner', name: 'Ivlison Souza' },
  admin: { email: ADMIN_EMAIL, role: 'admin', name: 'Ivlison Souza' },
  manager: { email: 'gestor@test.local', role: 'manager', name: 'Carlos Gestor' },
  technician: { email: 'tecnico@test.local', role: 'technician', name: 'Roberto Técnico' },
  viewer: { email: 'viewer@test.local', role: 'viewer', name: 'Ana Viewer' },
  seniorTech: { email: 'tecnico@test.local', role: 'technician', name: 'Roberto Técnico' },
  restrictedManager: {
    email: 'gestor@test.local',
    role: 'manager',
    name: 'Carlos Gestor',
  },
} as const;

/**
 * Login via Supabase Auth API (no UI navigation needed).
 * Injects the session token directly into localStorage.
 */
export async function loginAs(
  page: Page,
  email: string,
  password = DEFAULT_PASSWORD
): Promise<void> {
  // 1. Authenticate via Supabase REST API
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Login failed for ${email}: ${response.status} — ${body}`);
  }

  const session = await response.json();

  // 2. Navigate to the app (needed to set localStorage on the correct origin)
  await page.goto('/');

  // 3. Inject session token + skip ALL tours/modals into the browser's localStorage
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      // Skip guided tour, onboarding, and any first-time modals
      localStorage.setItem('effort-one-guided-tour-completed', 'true');
      localStorage.setItem('effort-one-onboarding-tour-dismissed', 'true');
      localStorage.setItem('effort-one-onboarding-completed', 'true');
      localStorage.setItem('effort-one-asset-onboarding-dismissed', 'true');
      localStorage.setItem('effort-one-wo-onboarding-dismissed', 'true');
      localStorage.setItem('effort-one-welcome-dismissed', 'true');
      localStorage.setItem('onboarding-dismissed', 'true');
      localStorage.setItem('tour-completed', 'true');
      // Accept cookie consent
      localStorage.setItem(
        'cookie-consent',
        JSON.stringify({
          essential: true,
          analytics: true,
          marketing: true,
          thirdParty: true,
          version: '1.0',
          timestamp: Date.now(),
        })
      );
      // Accept LGPD
      localStorage.setItem('lgpd-consent-accepted', 'true');
      // Force pt-BR language to avoid i18n mismatches in tests
      localStorage.setItem('effort-one-language', 'pt-BR');
      localStorage.setItem('i18nextLng', 'pt-BR');
    },
    { key: STORAGE_KEY, value: session }
  );

  // 4. Reload so the app picks up the session
  await page.reload();

  // 5. Dismiss any overlay/modal that may appear (onboarding, tours, alerts)
  await page.waitForTimeout(1500);
  const overlays = page.locator('[class*="fixed inset-0"], [class*="backdrop"], [role="dialog"]');
  const overlayCount = await overlays.count();
  for (let i = 0; i < overlayCount; i++) {
    const closeBtn = overlays
      .nth(i)
      .locator(
        'button:has-text("Fechar"), button:has-text("Pular"), button:has-text("Entendi"), button:has-text("OK"), button:has-text("Skip"), button[aria-label="Close"], button:has-text("×"), button:has-text("✕")'
      );
    if (
      await closeBtn
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false)
    ) {
      await closeBtn.first().click();
      await page.waitForTimeout(300);
    }
  }
  // Press Escape as final fallback to close any remaining overlay
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/**
 * Logout: clear localStorage and navigate to login.
 */
export async function logout(page: Page): Promise<void> {
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, STORAGE_KEY);
  await page.goto('/login');
}
