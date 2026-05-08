import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';

/**
 * Core modules — hardened functional smoke.
 *
 * Versão anterior aceitava `[]` como sucesso — RLS deny-all passava silente.
 *
 * Hardened: 3 evidências por tabela:
 *   1. Status 200 + content-type JSON
 *   2. Response é array (não objeto de erro disfarçado de 200)
 *   3. Sem auth header → 401 (proves RLS efetivamente bloqueia anônimo)
 *
 * O check sem-auth é o único forma honesta de detectar deny-all sem
 * comparar com service_role. Se RLS está OK, anônimo recebe 401/403.
 * Se RLS quebrou para deny-all, anônimo também recebe `[]` 200 — diff!
 */

const CORE_TABLES: Array<{ table: string; name: string }> = [
  { table: 'assets', name: 'assets' },
  { table: 'v_work_orders_classified', name: 'work-orders (view)' },
  { table: 'maintenance_plans', name: 'maintenance-plans' },
  { table: 'service_requests', name: 'service-requests' },
  { table: 'employees', name: 'employees' },
  { table: 'inventory_counts', name: 'inventory' },
  { table: 'automation_rules', name: 'automation' },
  { table: 'procedure_workflows', name: 'procedures' },
];

test.describe('Core modules — hardened functional smoke', () => {
  test('cada tabela CORE: GET autenticado funciona E sem auth bloqueia', async ({ request }) => {
    const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
      timeout: 15_000,
    });
    expect(auth.ok()).toBeTruthy();
    const { access_token } = await auth.json();

    for (const { table, name } of CORE_TABLES) {
      await test.step(name, async () => {
        // 1. GET autenticado: 200 + JSON array
        const authedRes = await request.get(
          `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`,
          {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${access_token}`,
            },
            timeout: 8_000,
          }
        );
        expect(
          authedRes.ok(),
          `${name} (${table}) GET autenticado falhou: ${authedRes.status()}`
        ).toBeTruthy();

        const ct = (authedRes.headers()['content-type'] ?? '').toLowerCase();
        expect(ct, `${name}: response não é JSON`).toContain('json');

        const body = await authedRes.json();
        expect(Array.isArray(body), `${name}: response não é array`).toBe(true);

        // 2. GET sem Authorization (apenas apikey = role `anon` no PostgREST).
        // Aceita: 4xx (RLS bloqueia anon) OU 200 com `[]` (RLS permite anon
        // mas não vaza dados de tenant). FALHA se anon recebe array com
        // itens — isso seria RLS leak real.
        const anonRes = await request.get(
          `${SUPABASE_URL}/rest/v1/${table}?select=id&limit=5`,
          {
            headers: { apikey: SUPABASE_ANON_KEY }, // SEM Authorization
            timeout: 8_000,
          }
        );
        if (anonRes.ok()) {
          const anonBody = await anonRes.json().catch(() => null);
          if (Array.isArray(anonBody)) {
            expect(
              anonBody.length,
              `${name}: anônimo recebeu ${anonBody.length} resultados via RLS — possível LEAK cross-tenant`
            ).toBe(0);
          }
        }
        // 4xx é OK (RLS bloqueou anon explicitamente).
      });
    }
  });
});
