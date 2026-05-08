import { Page, expect } from '@playwright/test';

/**
 * Auth helper — versão UI-form login (não localStorage injection).
 *
 * Razão: app calcula storageKey em runtime via getTenantSlug() do hostname
 * (apps/web/src/lib/supabase/client.ts) e roda tenantAccessGuard.checkTenantAccess
 * em onAuthStateChange (apps/web/src/hooks/useAuth.tsx). A SDK Supabase precisa
 * gerenciar a sessão pra disparar listener + guard corretamente.
 *
 * CLAUDE.md frontend regra: "NUNCA acessar token via localStorage. Sempre via
 * Supabase Auth API". Helper antigo bypassava SDK escrevendo localStorage direto
 * — gerava falsos positivos (asserts passavam mas user estava deslogado, página
 * exibia /login com marketing copy).
 *
 * NOVO fluxo: usa o próprio form de /login (real Supabase signInWithPassword
 * via SDK). Dispara listener, guard valida tenant, redirect natural.
 */

const DEFAULT_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';

/**
 * `true` quando ambiente tem usuários separados pra cada role
 * (gestor@test.local, tecnico@test.local, viewer@test.local).
 * Em homolog Rede D'Or esses usuários não existem — setar
 * E2E_HAS_MULTI_ROLE_USERS=false pra skipar tests dependentes.
 */
export const HAS_MULTI_ROLE_USERS = process.env.E2E_HAS_MULTI_ROLE_USERS !== 'false';

export interface TestUser {
  email: string;
  role: string;
  name: string;
}

export const TEST_USERS = {
  owner: { email: ADMIN_EMAIL, role: 'owner', name: 'Admin User' },
  admin: { email: ADMIN_EMAIL, role: 'admin', name: 'Admin User' },
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
 * Login via UI form. Usa a SDK do app — não bypass.
 *
 * Antes de logar, seta flags origin-scoped pra suprimir cookie/LGPD/tour
 * popups que aparecem mesmo pra usuário existente. Sem dismiss-cascade.
 */
export async function loginAs(
  page: Page,
  email: string,
  password = DEFAULT_PASSWORD
): Promise<void> {
  await page.goto('/login');

  // Flags origin-scoped — persistem para a navegação pós-login.
  await page.evaluate(() => {
    localStorage.setItem('effort-one-guided-tour-completed', 'true');
    localStorage.setItem('effort-one-onboarding-tour-dismissed', 'true');
    localStorage.setItem('effort-one-onboarding-completed', 'true');
    localStorage.setItem('effort-one-asset-onboarding-dismissed', 'true');
    localStorage.setItem('effort-one-wo-onboarding-dismissed', 'true');
    localStorage.setItem('effort-one-welcome-dismissed', 'true');
    localStorage.setItem('onboarding-dismissed', 'true');
    localStorage.setItem('tour-completed', 'true');
    localStorage.setItem('lgpd-consent-accepted', 'true');
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
    localStorage.setItem('effort-one-language', 'pt-BR');
    localStorage.setItem('i18nextLng', 'pt-BR');
  });

  // Fill form + submit. Seletores resilientes (3 fallbacks).
  await page
    .locator('input[type="email"], input[name="email"], #email')
    .first()
    .fill(email);
  await page
    .locator('input[type="password"], input[name="password"], #password')
    .first()
    .fill(password);
  await page.locator('button[type="submit"]').first().click();

  // Sai de /login = login OK. Falha aqui = creds inválidas, conta bloqueada,
  // tenant denied. waitForURL é determinístico; sem networkidle.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 30_000,
  });
}

/**
 * Logout robusto: clear todas keys de auth (sb-* tenant-aware), cookie consent
 * mantida, navigate /login.
 */
export async function logout(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('sb-') || k.includes('auth'))
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.goto('/login');
}

/**
 * Strict assertion: app carregou autenticado e tenant resolvido.
 *
 * Detecta os 4 falsos positivos identificados na auditoria:
 *   1. redirect para /login (sessão não persistiu);
 *   2. SessionExpired UI (auth signal contradiz session);
 *   3. TenantAccessDenied UI (user não tem company no tenant atual);
 *   4. landing/marketing copy do /login (deslogado).
 *
 * Chamar logo após `loginAs(...)` em testes que dependem de auth.
 */
export async function expectAuthenticatedOnApp(page: Page): Promise<void> {
  await expect(page, 'app redirecionou para /login após loginAs').not.toHaveURL(/\/login/, {
    timeout: 5_000,
  });

  // Não aceita /select-company nem /onboarding como "autenticado pra testar".
  // Ambos são estados intermediários — usuário não chegou no app real ainda.
  await expect(
    page,
    'app está em /select-company (usuário sem company ativa — não pronto pro teste)'
  ).not.toHaveURL(/\/select-company/, { timeout: 1_000 });
  await expect(page, 'app está em /onboarding (wizard inicial — não pronto pro teste)').not.toHaveURL(
    /\/onboarding/,
    { timeout: 1_000 }
  );

  const sessionExpired = page.getByText(/sessão expirada|session expired/i).first();
  await expect(sessionExpired, 'app exibiu Sessão Expirada (sessão dropada)').toHaveCount(0, {
    timeout: 1_000,
  });

  const tenantDenied = page.getByText(/sem acesso a este ambiente|tenant access denied/i).first();
  await expect(tenantDenied, 'usuário não tem acesso ao tenant do subdomain atual').toHaveCount(
    0,
    { timeout: 1_000 }
  );

  // Marketing copy do /login (split-screen). Se aparecer = deslogado.
  const marketingCopy = page.getByText(/à era da operação autônoma/i).first();
  await expect(
    marketingCopy,
    'app exibiu marketing copy de /login (usuário não autenticado)'
  ).toHaveCount(0, { timeout: 1_000 });
}
