import { test, expect, type Page } from '@playwright/test';
import {
  loginAs,
  TEST_USERS,
  HAS_MULTI_ROLE_USERS,
  expectAuthenticatedOnApp,
} from './helpers/auth';
import { waitForApp, navigateTo, expectNoAccessDenied } from './helpers/navigation';

/**
 * Permissions — hardened smoke.
 *
 * Versão anterior asseretava apenas ausência de "acesso negado". Falso
 * positivo: landing branca também passa, app em loading vazio também passa.
 *
 * Hardened: evidências POSITIVAS por role:
 *   - Owner: vê botões de criação ("Novo Ativo", "Nova OS") nas listas.
 *   - Manager (skip se sem user): bloqueado em /settings/users via redirect ou texto deny.
 *   - Technician/Viewer (skip): NÃO veem botão de criação em listas.
 *
 * Cada teste prova que UI carregou conteúdo real (não vazia, não loading)
 * antes de afirmar "permissão correta".
 */

async function expectPageContentLoaded(page: Page, label: string) {
  const main = page.locator('main, [role="main"]').first();
  await expect(main, `${label}: main não visível`).toBeVisible({ timeout: 5_000 });

  await page
    .waitForFunction(
      () => {
        const m = document.querySelector('main, [role="main"]');
        if (!m) return false;
        const sp = document.querySelectorAll('.animate-spin');
        return sp.length === 0 && m.children.length > 0;
      },
      { timeout: 15_000 }
    )
    .catch(() => {});

  const spinners = page.locator('.animate-spin');
  await expect(spinners, `${label}: travou em loading`).toHaveCount(0, { timeout: 3_000 });
}

test.describe('Permissions — hardened smoke', () => {
  test.setTimeout(60_000);

  test('owner: tem acesso a /assets, /os, /settings/users E vê botões de criação', async ({
    page,
  }) => {
    await loginAs(page, TEST_USERS.owner.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    // /assets: sem deny + main carregado + botão de criar visível (evidência positiva).
    await navigateTo(page, '/assets');
    await expectNoAccessDenied(page);
    await expectPageContentLoaded(page, '/assets');
    const ativoCreate = page.getByRole('button', {
      name: /(nov[ao]|criar|adicionar|new|create|add).*?(ativo|asset|equipamento)/i,
    });
    const ativoCreateLink = page.getByRole('link', {
      name: /(nov[ao]|criar|adicionar|new|create|add).*?(ativo|asset|equipamento)/i,
    });
    expect(
      (await ativoCreate.count()) + (await ativoCreateLink.count()),
      'owner não vê botão de criação em /assets — privilégio quebrado'
    ).toBeGreaterThan(0);

    // /os: idem.
    await navigateTo(page, '/os');
    await expectNoAccessDenied(page);
    await expectPageContentLoaded(page, '/os');
    const osCreate = page.getByRole('button', {
      name: /(nov[ao]|criar|adicionar|new|create|add).*?(os|wo|ordem|order|servi[çc]o)/i,
    });
    const osCreateLink = page.getByRole('link', {
      name: /(nov[ao]|criar|adicionar|new|create|add).*?(os|wo|ordem|order|servi[çc]o)/i,
    });
    expect(
      (await osCreate.count()) + (await osCreateLink.count()),
      'owner não vê botão de criação em /os — privilégio quebrado'
    ).toBeGreaterThan(0);

    // /settings/users: sem deny + main carregado.
    await navigateTo(page, '/settings/users');
    await expectNoAccessDenied(page);
    await expectPageContentLoaded(page, '/settings/users');
  });

  test('manager: bloqueado em /settings/users (redirect ou texto deny)', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário manager dedicado neste ambiente');
    await loginAs(page, TEST_USERS.manager.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    await navigateTo(page, '/settings/users');

    const denied = page.getByText(/acesso negado|access denied/i).first();
    const onSettingsUsers = page.url().includes('/settings/users');
    const hasDenied = await denied.isVisible({ timeout: 5_000 }).catch(() => false);

    // Manager precisa estar bloqueado de forma DETERMINÍSTICA — denied OU saiu.
    // Se ficou em /settings/users sem denied, smoke não detectaria privilégio
    // escalado.
    expect(
      hasDenied || !onSettingsUsers,
      'manager permaneceu em /settings/users sem mensagem de bloqueio — possível escalação'
    ).toBe(true);
  });

  test('technician: vê /assets MAS NÃO vê botão de criação', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário technician dedicado');
    await loginAs(page, TEST_USERS.technician.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    await navigateTo(page, '/assets');
    await expectPageContentLoaded(page, '/assets (technician)');

    // Tem que ver a lista (sem deny).
    await expectNoAccessDenied(page);

    // E NÃO pode ver botão de criar (privilégio negado).
    const novoAtivo = page.getByRole('button', { name: /novo ativo|new asset/i });
    expect(
      await novoAtivo.count(),
      'technician viu "Novo Ativo" — escalação de privilégio'
    ).toBe(0);
  });

  test('viewer: vê /assets MAS NÃO vê botão de criação', async ({ page }) => {
    test.skip(!HAS_MULTI_ROLE_USERS, 'sem usuário viewer dedicado');
    await loginAs(page, TEST_USERS.viewer.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);
    await navigateTo(page, '/assets');
    await expectPageContentLoaded(page, '/assets (viewer)');
    await expectNoAccessDenied(page);

    const novoAtivo = page.getByRole('button', { name: /novo ativo|new asset/i });
    expect(await novoAtivo.count(), 'viewer viu "Novo Ativo" — escalação').toBe(0);
  });
});
