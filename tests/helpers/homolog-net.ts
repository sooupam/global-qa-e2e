import { Page, Response, expect } from '@playwright/test';

/**
 * Helper compartilhado por todos os specs `homolog-*.spec.ts`.
 *
 * Funcionalidades:
 *  - Login via UI (rededorpcm) usando HOMOLOG_DANIEL_EMAIL/PASSWORD
 *  - Captura de respostas REST + Edge Functions
 *  - Filtros por código de erro PostgreSQL/PostgREST (23502, 42501, 42703, PGRST116, etc.)
 *  - Assertion utility por bug
 *
 * NÃO criamos dados de teste em homolog — todos os specs usam payloads
 * únicos com prefixo `[E2E]` e cleanup via soft-delete quando aplicável.
 */

export interface CapturedFailure {
  url: string;
  status: number;
  body: string;
  /** Códigos PostgreSQL/PostgREST extraídos do body, se houver. */
  codes: string[];
}

const HOMOLOG_EMAIL = process.env.HOMOLOG_DANIEL_EMAIL || '';
const HOMOLOG_PASSWORD = process.env.HOMOLOG_DANIEL_PASSWORD || '';

export const HAS_HOMOLOG_CREDS = Boolean(HOMOLOG_EMAIL && HOMOLOG_PASSWORD);

/**
 * Faz login na UI (rededorpcm). Lança se credenciais ausentes.
 * Após login, espera dashboard estabilizar.
 *
 * Pre-flight: set localStorage cookie/onboarding flags para não bloquear UI.
 */
export async function homologLogin(page: Page): Promise<void> {
  if (!HAS_HOMOLOG_CREDS) {
    throw new Error('HOMOLOG_DANIEL_EMAIL e HOMOLOG_DANIEL_PASSWORD obrigatórios');
  }

  // 1. Vai pra /login (origin precisa estar acessível pra setar localStorage)
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // 2. Set localStorage flags ANTES de qualquer interação — evita banner cookie + tours
  await page.evaluate(() => {
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
    localStorage.setItem('lgpd-consent-accepted', 'true');
    localStorage.setItem('effort-one-guided-tour-completed', 'true');
    localStorage.setItem('effort-one-onboarding-tour-dismissed', 'true');
    localStorage.setItem('effort-one-onboarding-completed', 'true');
    localStorage.setItem('effort-one-asset-onboarding-dismissed', 'true');
    localStorage.setItem('effort-one-wo-onboarding-dismissed', 'true');
    localStorage.setItem('effort-one-welcome-dismissed', 'true');
    localStorage.setItem('onboarding-dismissed', 'true');
    localStorage.setItem('tour-completed', 'true');
    localStorage.setItem('effort-one-language', 'pt-BR');
    localStorage.setItem('i18nextLng', 'pt-BR');
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  const emailInput = page.locator('input[type="email"], input[name="email"], #email').first();
  const passwordInput = page
    .locator('input[type="password"], input[name="password"], #password')
    .first();

  await expect(emailInput).toBeVisible({ timeout: 15_000 });
  await emailInput.fill(HOMOLOG_EMAIL);
  await passwordInput.fill(HOMOLOG_PASSWORD);
  await page.locator('button[type="submit"]').first().click();

  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  console.log(`[homolog] post-login URL: ${page.url()}`);

  // Cookie banner fallback (se localStorage não pegou)
  await page
    .locator('button:has-text("Aceitar")')
    .first()
    .click({ timeout: 3_000 })
    .catch(() => {});

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  // Set activeCompany via API direta (bypassa UI flaky de /select-company).
  // Estratégia: resolver SANTA ISABEL UUID via REST + UPSERT em user_active_company.
  // Funciona pra Daniel (global admin) que tem acesso a todas as companies.
  let apiOk = false;
  try {
    await setActiveCompanyViaApi(page);
    apiOk = true;
  } catch (err: any) {
    console.error(`[homolog] setActiveCompanyViaApi FAIL: ${err.message}`);
  }

  // Após API set: força reload pra useActiveCompany re-fetchar do DB.
  // Sem isso, frontend tem context cacheado de antes do INSERT.
  if (apiOk) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  } else {
    // Fallback UI (mais lento)
    await uiSelectCompanyFallback(page);
  }

  // Espera "Carregando..." sumir (loading inicial da app)
  const loading = page.getByText(/^carregando\.\.\.$/i).first();
  await loading.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});

  console.log(`[homolog] dashboard URL: ${page.url()}`);
}

/**
 * Seta activeCompany direto via Supabase REST (bypassa UI /select-company).
 * Lê SANTA ISABEL UUID + UPSERT em user_active_company. Mais rápido e
 * confiável que UI flow.
 */
async function setActiveCompanyViaApi(page: Page): Promise<void> {
  const session = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (!keys.length) return null;
    const raw = localStorage.getItem(keys[0]);
    return raw ? JSON.parse(raw) : null;
  });

  if (!session?.access_token || !session?.user?.id) {
    throw new Error('Sem session token no localStorage');
  }

  const baseUrl = page.url().split('/').slice(0, 3).join('/');
  // Local: api é localhost:54321; Homolog: api.<tenant>.globalthings.net
  const apiBase = baseUrl.includes('localhost')
    ? 'http://localhost:54321'
    : `https://api.${new URL(baseUrl).hostname.split('.').slice(-3).join('.')}`;

  // Anon key hardcoded — Supabase self-hosted demo key (idêntico em local + homolog
  // self-hosted). Se ambiente usar key custom, override via env SUPABASE_ANON_KEY.
  const ANON_KEY =
    process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };

  // 1. Busca SANTA ISABEL company_id
  const companiesResp = await page.request.get(
    `${apiBase}/rest/v1/companies?name=eq.SANTA%20ISABEL&select=id,tenant_id&limit=1`,
    { headers }
  );
  const companies = await companiesResp.json().catch(() => []);
  if (!Array.isArray(companies) || !companies.length) {
    throw new Error(
      `Companies REST falhou: ${companiesResp.status()} — ${JSON.stringify(companies)}`
    );
  }

  const company = companies[0];

  // 2. DELETE rows existentes do user (evita maybeSingle "more than one row").
  // Em localhost sem subdomain, useActiveCompany não filtra por tenant_id,
  // então múltiplos rows quebram o restore.
  const deleteResp = await page.request.delete(
    `${apiBase}/rest/v1/user_active_company?user_id=eq.${session.user.id}`,
    { headers }
  );
  if (deleteResp.status() >= 400 && deleteResp.status() !== 404) {
    console.warn(`[homolog] DELETE user_active_company status=${deleteResp.status()}`);
  }

  // 3. INSERT clean
  const insertResp = await page.request.post(`${apiBase}/rest/v1/user_active_company`, {
    headers: { ...headers, Prefer: 'return=minimal' },
    data: { user_id: session.user.id, company_id: company.id, tenant_id: company.tenant_id },
  });

  if (insertResp.status() >= 400) {
    const body = await insertResp.text();
    throw new Error(`INSERT user_active_company falhou: ${insertResp.status()} — ${body}`);
  }

  console.log(`[homolog] activeCompany=SANTA ISABEL (${company.id}) via API`);
}

/**
 * Fallback UI se API direta falhar — clica em SANTA ISABEL na lista.
 */
async function uiSelectCompanyFallback(page: Page): Promise<void> {
  if (!page.url().includes('/select-company')) {
    await page.goto('/select-company', { waitUntil: 'domcontentloaded' });
  }
  const searchBox = page.getByPlaceholder(/buscar/i).first();
  if (await searchBox.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await searchBox.fill('SANTA ISABEL');
    await page.waitForTimeout(800);
  }
  const santaIsabel = page.getByRole('button', { name: /santa isabel/i }).first();
  await santaIsabel.click({ timeout: 10_000 }).catch(() => {});
  await page
    .waitForURL((url) => !url.pathname.includes('/select-company'), { timeout: 30_000 })
    .catch(() => {});
}

/**
 * Instala um listener no `page.on('response')` que acumula falhas REST
 * (status >= 400). Retorna o array de falhas (mutado em runtime).
 *
 * Filtra apenas chamadas pra api.<tenant>.globalthings.net (REST + EF).
 */
export function trackApiFailures(page: Page): CapturedFailure[] {
  const failures: CapturedFailure[] = [];

  page.on('response', async (resp: Response) => {
    const url = resp.url();
    const status = resp.status();
    // Aceita Supabase REST/EF tanto remoto (api.*.globalthings.net) quanto local (localhost:54321)
    const isApi =
      /api\.[^/]+\.globalthings\.net\/(rest|functions)\//.test(url) ||
      /localhost:\d+\/(rest|functions)\//.test(url) ||
      /127\.0\.0\.1:\d+\/(rest|functions)\//.test(url);
    if (!isApi) return;
    if (status < 400) return;

    let body = '';
    try {
      body = (await resp.text()).slice(0, 1000);
    } catch {
      body = '<unreadable>';
    }

    // Códigos comuns: PostgreSQL (5 dígitos) + PostgREST (PGRSTxxx)
    const codes: string[] = [];
    const pgCodeMatch = body.match(/"code":"(\w+)"/);
    if (pgCodeMatch) codes.push(pgCodeMatch[1]);
    if (body.includes('PGRST116')) codes.push('PGRST116');
    if (body.includes('row-level security')) codes.push('42501');

    failures.push({ url, status, body, codes });
  });

  return failures;
}

/**
 * Asserta que NENHUMA falha capturada contém os códigos passados.
 * Lança erro detalhado se encontrar.
 */
export function assertNoFailureCodes(
  failures: CapturedFailure[],
  unwantedCodes: string[],
  context: string
): void {
  const hits = failures.filter((f) => f.codes.some((c) => unwantedCodes.includes(c)));
  if (hits.length === 0) return;

  const detail = hits
    .map(
      (f) =>
        `  ${f.status} [${f.codes.join(',')}] ${f.url.replace(/^https:\/\/[^/]+/, '')}\n` +
        `    ${f.body.slice(0, 300)}`
    )
    .join('\n');

  throw new Error(
    `[${context}] ${hits.length} falha(s) com código(s) não esperado(s) ${unwantedCodes.join(',')}:\n${detail}`
  );
}

/**
 * Espera por uma resposta específica que match um padrão de URL.
 * Útil pra capturar response de POST/PATCH específico após click.
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: RegExp,
  options?: { timeout?: number; method?: string }
): Promise<Response> {
  const timeout = options?.timeout ?? 15_000;
  const method = options?.method;
  return page.waitForResponse(
    (resp) => urlPattern.test(resp.url()) && (!method || resp.request().method() === method),
    { timeout }
  );
}

/**
 * Limpa toasts ativos pra não poluir asserts subsequentes.
 */
export async function dismissToasts(page: Page): Promise<void> {
  const toastClose = page.locator('[data-sonner-toast] button[aria-label="Close toast"]');
  const count = await toastClose.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    await toastClose
      .first()
      .click({ timeout: 500 })
      .catch(() => {});
  }
}

/**
 * Marker único pra dados criados em testes — facilita identificação e cleanup.
 */
export function e2eMark(): string {
  return `[E2E ${Date.now()}-${Math.random().toString(36).slice(2, 6)}]`;
}
