import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';

/**
 * Smoke: AI Hub — hardened.
 *
 * Versão anterior aceitava status<500 como sucesso. Falso positivo: 401/403
 * passavam, mascarando AI Hub completamente bloqueado.
 *
 * Versão hardened valida 2 contratos:
 *   1. Sem auth → 401 (proves enforcement de auth está vivo)
 *   2. Com auth + payload vazio → 200 OU 4xx COM JSON estruturado
 *      (proves: função processou input, não crashou no boot, não está
 *      retornando 5xx ou HTML genérico de erro do Edge runtime).
 *
 * NÃO valida output da IA (não-determinístico).
 */

test.describe('AI Hub — hardened smoke', () => {
  test('sem auth retorna 401 (auth enforcement vivo)', async ({ request }) => {
    const res = await request.post(`${SUPABASE_URL}/functions/v1/ai-hub`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      data: { context: 'health', action: 'ping' },
      failOnStatusCode: false,
      timeout: 15_000,
    });
    expect(
      res.status(),
      `AI Hub aceitou request sem Bearer token (status=${res.status()}) — auth enforcement quebrado`
    ).toBe(401);
  });

  test('com auth processa request (200 ou 4xx estruturado)', async ({ request }) => {
    const auth = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
      timeout: 15_000,
    });
    expect(auth.ok(), `login API falhou: ${auth.status()}`).toBeTruthy();
    const { access_token } = await auth.json();

    const res = await request.post(`${SUPABASE_URL}/functions/v1/ai-hub`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      data: {},
      failOnStatusCode: false,
      timeout: 15_000,
    });

    // Status precisa estar em 200-499 e NÃO ser 401/403 (com auth válido,
    // 401/403 significa edge function reject erroneamente).
    expect(
      res.status(),
      `AI Hub retornou ${res.status()} — esperado 200 ou 4xx estruturado, NÃO 401/403/5xx`
    ).toBeLessThan(500);
    expect(
      res.status(),
      `AI Hub rejeitou Bearer válido com ${res.status()} — auth quebrada`
    ).not.toBe(401);
    expect(
      res.status(),
      `AI Hub rejeitou Bearer válido com 403 — permission ou config quebrada`
    ).not.toBe(403);

    // Body precisa ser JSON parseável (Edge runtime crashado retorna HTML).
    const ct = (res.headers()['content-type'] ?? '').toLowerCase();
    expect(ct, `AI Hub não retornou JSON (content-type=${ct})`).toContain('json');

    const body = await res.json().catch(() => null);
    expect(body, 'AI Hub retornou body que não parseia como JSON').not.toBeNull();
  });
});
