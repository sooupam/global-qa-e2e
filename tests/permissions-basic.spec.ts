import { test, expect, type Page } from '@playwright/test';
import { loginAs, TEST_USERS, HAS_MULTI_ROLE_USERS } from './helpers/auth';
import { waitForApp, navigateTo, expectNoAccessDenied } from './helpers/navigation';

/**
 * Suite: Permissions — smoke (consolidado).
 *
 * Reduzido de 20 → 4 testes. Os 16 removidos eram regressão de RBAC
 * granular (button-by-button por role × resource), não smoke. O risco
 * crítico é "permissão rompida em hierarquia inteira", não "botão X
 * sumiu para role Y".
 *
 * Cobertura mantida:
 *  - Owner: tem acesso aos núcleos (assets/os/settings.users) → smoke
 *    do happy path total.
 *  - Manager: bloqueado em /settings/users → smoke da hierarquia.
 *  - Technician/Viewer: NÃO veem ações de criar em assets → smoke de
 *    deny path. (Skipados se HAS_MULTI_ROLE_USERS=false.)
 */

async function hasAction(page: Page, text: RegExp): Promise<boolean> {
  const el = page
    .locator('main')
    .getByRole('button', { name: text })
    .or(page.locator('main').getByRole('link', { name: text }));
  return (await el.count()) > 0 && (await el.first().isVisible({ timeout: 2_000 }).catch(() => false));
}

test.describe('Permissions — smoke', () => {
  test.setTimeout(60_000);

  test('owner: acesso a /assets, /os e /settings/users sem access denied', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner.email);
    await waitForApp(page);

    for (const path of ['/assets', '/os', '/settings/users']) {
      await navigateTo(page, path);
      await expectNoAccessDenied(page);
    }
  });

  test('manager: bloqueado em /settings/users', async ({ page }) => {
    await loginAs(page, TEST_USERS.manager.email);
    await waitForApp(page);
    await navigateTo(page, '/settings/users');

    const denied = page.getByText(/acesso negado|access denied/i);
    const onSettingsUsers = page.url().includes('/settings/users');
    const hasDenied = (await denied.count().catch(() => 0)) > 0;
    expect(
      hasDenied || !onSettingsUsers,
      'manager permaneceu em /settings/users sem mensagem de bloqueio'
    ).toBe(true);
  });

  test('technician: não vê ações de criar em /assets nem /os', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário technician dedicado');
    await loginAs(page, TEST_USERS.technician.email);
    await waitForApp(page);

    await navigateTo(page, '/assets');
    expect(await hasAction(page, /novo ativo/i), 'technician viu "Novo Ativo"').toBe(false);

    await navigateTo(page, '/os');
    expect(await hasAction(page, /nova os/i), 'technician viu "Nova OS"').toBe(false);
  });

  test('viewer: não vê ações de criar em /assets', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário viewer dedicado');
    await loginAs(page, TEST_USERS.viewer.email);
    await waitForApp(page);
    await navigateTo(page, '/assets');

    expect(await hasAction(page, /novo ativo/i), 'viewer viu "Novo Ativo"').toBe(false);
    await expectNoAccessDenied(page);
  });
});
