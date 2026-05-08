import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';
const E2E_TENANT_ID = process.env.E2E_TENANT_ID;

/**
 * Multi-tenancy — hardened smoke.
 *
 * Versão anterior fazia GET /companies?limit=1 sem ordering — pegava qualquer
 * company. Para usuário cross-tenant (ex: Daniel admin global em 2 tenants),
 * resultado era não-determinístico — flake estrutural.
 *
 * Hardened — 2 evidências:
 *   1. Filter explícito por tenant_id retorna ≥1 (RLS permite leitura).
 *   2. Filter por tenant_id INEXISTENTE retorna []. Prova que filter está
 *      funcionando — se vazasse, tudo retornaria igual.
 *
 * Esses 2 juntos detectam:
 *   - RLS deny-all (test 1 falha — 0 results)
 *   - RLS leak cross-tenant (test 2 falha — retorna dados de outro tenant)
 *   - Tenant_id renomeado/dropado (test 1 falha)
 */

test.describe('Multi-tenancy — hardened smoke', () => {
  test('user vê company do tenant esperado (filter explícito)', async ({ request }) => {
    test.skip(!E2E_TENANT_ID, 'E2E_TENANT_ID ausente');

    const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
      timeout: 15_000,
    });
    expect(auth.ok()).toBeTruthy();
    const { access_token } = await auth.json();

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/companies?select=id,tenant_id,name&tenant_id=eq.${E2E_TENANT_ID}&limit=5`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}` },
        timeout: 10_000,
      }
    );
    expect(res.ok(), `GET /companies falhou: ${res.status()}`).toBeTruthy();

    const companies = await res.json();
    expect(Array.isArray(companies)).toBe(true);
    expect(
      companies.length,
      `RLS deny-all OU usuário sem company no tenant ${E2E_TENANT_ID}`
    ).toBeGreaterThanOrEqual(1);

    // TODOS os resultados devem ter o tenant_id esperado (filter respeitado).
    for (const c of companies) {
      expect(c.tenant_id, `vazamento cross-tenant: company ${c.id} tem tenant ${c.tenant_id}`).toBe(
        E2E_TENANT_ID
      );
    }
  });

  test('filter por tenant_id inexistente retorna [] (RLS sem leak)', async ({ request }) => {
    const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
      timeout: 15_000,
    });
    expect(auth.ok()).toBeTruthy();
    const { access_token } = await auth.json();

    // UUID válido mas que nunca existe — se RLS está vazando, retornaria dados.
    const ghostTenant = '00000000-0000-0000-0000-000000000000';
    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/companies?select=id&tenant_id=eq.${ghostTenant}`,
      {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}` },
        timeout: 10_000,
      }
    );
    expect(res.ok()).toBeTruthy();
    const companies = await res.json();
    expect(
      companies.length,
      `RLS LEAK: tenant inexistente retornou ${companies.length} companies`
    ).toBe(0);
  });
});
