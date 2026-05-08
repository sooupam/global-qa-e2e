import { test, expect } from '@playwright/test';

/**
 * Smoke: contrato funcional de módulos CORE.
 *
 * Page-load (`modules-load.spec.ts`) só prova que a rota renderiza e
 * o React não cai em error boundary. NÃO prova que:
 *   - a tabela base existe;
 *   - RLS permite leitura para o usuário-robô (admin);
 *   - PostgREST responde sem 4xx;
 *   - tenant resolve a query (não vira deny-all).
 *
 * Este spec preenche essa lacuna com 1 assert mínimo por módulo CORE:
 * GET /rest/v1/<tabela>?select=*&limit=1 → 200 + array.
 *
 * NÃO valida quantidade de dados (tenant de teste pode estar vazio).
 * NÃO valida shape do payload (regressão de schema, não smoke).
 * NÃO valida UI (já coberto por modules-load).
 *
 * Tudo em 1 só teste com test.step — login uma vez, 8 GETs ~50ms cada.
 *
 * Módulos não cobertos aqui (justificativa):
 *  - sectors, contracts, field: tabelas ambíguas (vivem em adapters
 *    multi-tabela). modules-load cobre o page-load.
 *  - compliance core: release v3.29 ainda estabilizando — alta churn.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';

const CORE_TABLES: Array<{ table: string; name: string }> = [
  { table: 'assets', name: 'assets' },
  { table: 'v_work_orders_classified', name: 'work-orders (view real)' },
  { table: 'maintenance_plans', name: 'maintenance-plans' },
  { table: 'service_requests', name: 'service-requests' },
  { table: 'employees', name: 'employees' },
  { table: 'inventory_counts', name: 'inventory' },
  { table: 'automation_rules', name: 'automation' },
  { table: 'procedure_workflows', name: 'procedures' },
];

test.describe('Core modules — functional API smoke', () => {
  test('cada módulo CORE responde GET na tabela base sem 4xx', async ({ request }) => {
    const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
      timeout: 15_000,
    });
    expect(auth.ok(), `login API falhou: ${auth.status()}`).toBeTruthy();
    const { access_token } = await auth.json();

    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${access_token}`,
    };

    for (const { table, name } of CORE_TABLES) {
      await test.step(name, async () => {
        const res = await request.get(
          `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`,
          { headers, timeout: 8_000 }
        );
        expect(
          res.ok(),
          `${name} (${table}) GET retornou ${res.status()} — backend ou RLS quebrado`
        ).toBeTruthy();
        const body = await res.json();
        expect(Array.isArray(body), `${name} (${table}) response não é JSON array`).toBe(true);
      });
    }
  });
});
