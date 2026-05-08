import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'ivlison.souza@globalthings.net';
const E2E_PASSWORD = process.env.E2E_PASSWORD || 'Five5@#$';

/**
 * Smoke: AI Hub.
 *
 * O `aiHubApi.invoke(context, action, payload)` é o gateway centralizado
 * para 100% das funcionalidades de IA do app. Se essa edge function cair,
 * Copilot, dispatch recommendations, AI fields, renewal assistant — todos
 * quebram juntos.
 *
 * Estratégia: POST com payload vazio. Não validamos shape/conteúdo (IA é
 * não-determinística). Asserção: status < 500 prova que a função está
 * deployada e processa requisições — se houver validation error (4xx),
 * é resposta esperada e a função está viva.
 */
test.describe('AI Hub — smoke', () => {
  test('edge function ai-hub deployada e não retorna 5xx', async ({ request }) => {
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
    expect(res.status(), 'AI Hub retornou 5xx — função quebrou').toBeLessThan(500);
  });
});
