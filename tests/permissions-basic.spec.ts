import { test, expect, type Page } from '@playwright/test';
import {
  loginAs,
  TEST_USERS,
  HAS_MULTI_ROLE_USERS,
  expectAuthenticatedOnApp,
} from './helpers/auth';
import { waitForApp, navigateTo, expectNoAccessDenied } from './helpers/navigation';

/**
 * Permissions — hardened smoke v2.
 *
 * Versão anterior asserava presença de botão "Nova OS" — frágil porque
 * texto vem de i18n (`workOrders.create` → "Criar Ordem de Serviço") e
 * o botão é renderizado por CrudPageTemplate via prop condicional
 * `can('workOrders.create')`. Se permissão estiver gated, botão não
 * aparece — falso negativo de UI drift quando o real era falta de perm.
 *
 * Hardened v2: testa autorização de ROTA, não texto de botão.
 *   - Owner: pode goto /assets/new, /work-orders/new, /settings/users SEM
 *     deny e SEM redirect (URL final == URL pedida).
 *   - Manager: redirecionado/deny em /settings/users (skip se sem user).
 *   - Technician: redirecionado/deny em /assets/new e /work-orders/new.
 *   - Viewer: redirecionado/deny em /assets/new.
 *
 * URL gate é o controle de autorização real do app — testar isso é mais
 * estável que testar UI condicional.
 */

async function expectAtPath(page: Page, expectedPath: string, label: string) {
  const url = new URL(page.url());
  expect(
    url.pathname,
    `${label}: esperado em ${expectedPath}, mas está em ${url.pathname}`
  ).toBe(expectedPath);
}

async function expectBlockedFromPath(page: Page, restrictedPath: string, label: string) {
  // Race entre redirect (URL muda) e deny visível.
  const result = await Promise.any([
    page
      .waitForURL((u) => !u.pathname.startsWith(restrictedPath), { timeout: 5_000 })
      .then(() => 'redirect' as const),
    page
      .getByText(/acesso negado|access denied/i)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => 'denied' as const),
  ]).catch(() => null);
  expect(
    result,
    `${label}: usuário não foi bloqueado de ${restrictedPath} (sem redirect, sem deny)`
  ).not.toBeNull();
}

test.describe('Permissions — route-level smoke', () => {
  test.setTimeout(120_000);

  test('owner: acessa rotas de criação e admin sem deny nem redirect', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    for (const path of ['/assets/new', '/work-orders/new', '/settings/users']) {
      await navigateTo(page, path);
      await expectNoAccessDenied(page);
      await expectAuthenticatedOnApp(page); // não caiu em /login, /select-company, /onboarding
      await expectAtPath(page, path, `owner em ${path}`);
    }
  });

  test('manager: bloqueado em /settings/users (deny ou redirect)', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário manager dedicado');
    await loginAs(page, TEST_USERS.manager.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    await navigateTo(page, '/settings/users');
    await expectBlockedFromPath(page, '/settings/users', 'manager');
  });

  test('technician: bloqueado em /assets/new E /work-orders/new', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário technician dedicado');
    await loginAs(page, TEST_USERS.technician.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    await navigateTo(page, '/assets/new');
    await expectBlockedFromPath(page, '/assets/new', 'technician /assets/new');

    await navigateTo(page, '/work-orders/new');
    await expectBlockedFromPath(page, '/work-orders/new', 'technician /work-orders/new');
  });

  test('viewer: bloqueado em /assets/new', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário viewer dedicado');
    await loginAs(page, TEST_USERS.viewer.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    await navigateTo(page, '/assets/new');
    await expectBlockedFromPath(page, '/assets/new', 'viewer /assets/new');
  });
});
