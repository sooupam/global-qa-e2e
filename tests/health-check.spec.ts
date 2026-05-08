import { test, expect } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/**
 * Health check — smoke mínimo.
 *
 * Edge function `health-check` faz query simples em `locations` via service_role
 * e retorna status. Fonte canônica: supabase/functions/health-check/index.ts.
 *
 * Detecta:
 *   - Edge runtime fora ar (5xx ou network error)
 *   - DB inalcançável (function retorna 503 com status='unhealthy')
 *   - Latência DB ≥ 5s (pode indicar contention ou DB hibernado)
 *
 * Assert positivo de status='healthy' — NÃO aceita 'unhealthy' como passa.
 */

test.describe('Health check — smoke', () => {
  test('edge function health-check retorna status=healthy + latência razoável', async ({
    request,
  }) => {
    const res = await request.get(`${SUPABASE_URL}/functions/v1/health-check`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      timeout: 10_000,
    });
    expect(res.ok(), `health-check retornou status HTTP ${res.status()}`).toBeTruthy();

    const ct = (res.headers()['content-type'] ?? '').toLowerCase();
    expect(ct, 'health-check não retornou JSON').toContain('json');

    const body = await res.json();
    expect(
      body.status,
      `health-check reportou status='${body.status}' (esperado 'healthy') — backend degradado`
    ).toBe('healthy');
    expect(typeof body.latency_ms, 'latency_ms ausente ou tipo inválido').toBe('number');
    expect(body.latency_ms, 'latência DB > 5s — query de locations está lenta').toBeLessThan(
      5000
    );
    expect(typeof body.timestamp, 'timestamp ausente').toBe('string');
  });
});
