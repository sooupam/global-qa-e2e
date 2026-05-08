import { test, expect } from '@playwright/test';

/**
 * Smoke: rotas públicas (sem auth).
 *
 * Rotas que clientes/fornecedores/field workers usam externamente. Se a
 * CDN/static hosting falhar em servir HTML para QUALQUER uma dessas, o
 * usuário externo fica sem fallback (não há login no caminho para retry).
 *
 * Estratégia: HTTP GET puro (zero browser, zero JS). Asserção:
 *   - status < 400 (200 ou 3xx redirect aceitos)
 *   - content-type contém "html"
 *   - body tem `<html`
 *
 * Detecta: catch-all do SPA quebrado, deploy parcial, cert SSL expirado,
 * roteamento de CDN regredido. NÃO valida fluxo interno da página
 * (assinatura, formulário, render do payload do token) — isso é regressão.
 *
 * Tokens são placeholders intencionais ("smoke-..."): a página deve
 * RENDERIZAR mesmo com token inválido (mostra erro inline), não 5xx.
 */

const PUBLIC_ROUTES: Array<{ path: string; name: string }> = [
  { path: '/sign-portal/smoke-invalid-token', name: 'sign-portal (cliente assina contrato)' },
  { path: '/request/new', name: 'request/new (cliente abre SR pública)' },
  { path: '/qr/asset/smoke-id', name: 'qr-landing (field worker via QR)' },
  { path: '/vendor/onboarding/smoke-token', name: 'vendor-onboarding (fornecedor)' },
  { path: '/public/quote/smoke-token', name: 'public-quote (cliente recebe cotação comercial)' },
  { path: '/install', name: 'pwa-install' },
];

test.describe('Public routes — smoke', () => {
  for (const { path, name } of PUBLIC_ROUTES) {
    test(`${name} retorna HTML válido`, async ({ request }) => {
      const res = await request.get(path, { timeout: 10_000 });
      expect(res.status(), `${path} retornou ${res.status()}`).toBeLessThan(400);
      const ct = (res.headers()['content-type'] ?? '').toLowerCase();
      expect(ct, `${path} não retornou HTML (content-type=${ct})`).toContain('html');
      const body = (await res.text()).toLowerCase();
      expect(body, `${path} não tem tag <html no body`).toContain('<html');
    });
  }
});
