import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';
const E2E_TENANT_ID = process.env.E2E_TENANT_ID;

/**
 * Smoke: Multi-tenancy / RLS.
 *
 * GT ONE tem multi-tenancy SingleDB com defense-in-depth (RLS + RPC + adapter
 * + edge). Após 18 migrations Pattern C em 24h e 4 leak clamps recentes, o
 * risco de policy quebrada (deny-all OU cross-tenant leak) é alto.
 *
 * Estratégia: API login + GET /rest/v1/companies. Se o usuário-robô não vê
 * nenhuma company → RLS rompida (deny-all). Se vê company com tenant_id
 * errado → leak cross-tenant. Valida 2 das 4 camadas sem flake de UI.
 */
test.describe('Multi-tenancy — smoke', () => {
  test('usuário-robô vê ≥1 company com tenant_id correto via REST', async ({ request }) => {
    test.skip(!E2E_TENANT_ID, 'E2E_TENANT_ID ausente — pulando assert de tenant_id');

    const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
      timeout: 15_000,
    });
    expect(auth.ok(), `login API falhou: ${auth.status()}`).toBeTruthy();
    const { access_token } = await auth.json();

    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/companies?select=id,tenant_id&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${access_token}`,
        },
        timeout: 10_000,
      }
    );
    expect(res.ok(), `GET /companies falhou: ${res.status()}`).toBeTruthy();

    const companies = await res.json();
    expect(Array.isArray(companies), 'response não é array').toBe(true);
    expect(
      companies.length,
      'usuário-robô não vê nenhuma company — RLS pode ter virado deny-all'
    ).toBeGreaterThanOrEqual(1);
    expect(
      companies[0].tenant_id,
      'tenant_id divergente — possível leak cross-tenant ou migration drift'
    ).toBe(E2E_TENANT_ID);
  });
});
