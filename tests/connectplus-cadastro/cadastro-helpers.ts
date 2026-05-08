/**
 * Helpers compartilhados pra suite Phase 2 — Cadastro UI ConnectPlus.
 *
 * Padrões:
 *   • baseURL = http://e2e-test.localhost:8080 (subdomain → tenant e2e-test)
 *   • Login = daniel.rodrigues@globalthings.net (global admin, vê e2e-test)
 *   • Cleanup via cleanupDynamic() do iot-context.ts
 *
 * Cada entidade tem 4 specs: list / create / edit / delete.
 * Helpers aqui evitam duplicação dessas 4 estruturas.
 */

import { type Page, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { waitForApp } from '../helpers/navigation';

export const E2E_TEST_BASE_URL = 'http://e2e-test.localhost:8080';
export const E2E_ADMIN_EMAIL = 'daniel.rodrigues@globalthings.net';

/** Login + waitForApp num único call. Usa em beforeEach. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAs(page, E2E_ADMIN_EMAIL);
  await waitForApp(page);
}

/** Navega pra rota dentro do tenant e2e-test. */
export async function gotoConnect(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

/**
 * Asserta que página de listagem renderizou sem error boundary.
 * Aceita: empty state, lista com rows, ou skeleton (não fatal).
 */
export async function expectListPageRendered(page: Page): Promise<void> {
  // ErrorBoundary fatal
  const error = page.getByText(/Erro no módulo|something went wrong|algo deu errado/i);
  await expect(error).toHaveCount(0, { timeout: 5_000 });
  // Access denied
  const denied = page.getByText(/acesso negado|access denied/i);
  await expect(denied).toHaveCount(0, { timeout: 3_000 });
}

/**
 * Clica botão "Novo X" / "Criar X" / "+" tolerantemente.
 * Tenta múltiplos textos comuns no codebase.
 */
export async function clickCreateButton(
  page: Page,
  labelRegex: RegExp = /novo|criar|nova|adicionar|new|create/i
): Promise<void> {
  const btn = page.getByRole('button', { name: labelRegex }).first();
  const link = page.getByRole('link', { name: labelRegex }).first();
  // Prefer link (route nav) sobre button (modal)
  if ((await link.count()) > 0) {
    await link.click();
  } else {
    await btn.click();
  }
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

/**
 * Preenche input por id (padrão usado em forms ConnectPlus).
 * Falha silenciosa se campo não existir (alguns são opcionais).
 */
export async function fillById(
  page: Page,
  id: string,
  value: string,
  opts: { required?: boolean } = {}
): Promise<void> {
  const input = page.locator(`#${id}`);
  const count = await input.count();
  if (count === 0) {
    if (opts.required) throw new Error(`Required field #${id} not found`);
    return;
  }
  await input.fill(value);
}

/**
 * Seleciona valor em <Select> shadcn (Radix). Click trigger + click item.
 */
export async function selectShadcn(
  page: Page,
  triggerSelector: string,
  optionText: string | RegExp
): Promise<void> {
  await page.locator(triggerSelector).click();
  const opt =
    typeof optionText === 'string'
      ? page.getByRole('option', { name: optionText, exact: false }).first()
      : page.getByRole('option', { name: optionText }).first();
  await opt.click();
}

/**
 * Submeter form via botão "Salvar" / "Criar" / "Save".
 * Aguarda navegação ou toast de sucesso.
 */
export async function submitForm(page: Page, successPathRegex?: RegExp): Promise<void> {
  const submit = page.getByRole('button', { name: /salvar|criar|save|create/i }).last();
  await submit.click();
  // Aguarda redirect ou toast
  if (successPathRegex) {
    await page.waitForURL(successPathRegex, { timeout: 15_000 }).catch(() => {});
  } else {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }
}

/** Asserta presença de toast Sonner. */
export async function expectToast(
  page: Page,
  msgRegex: RegExp = /sucesso|criado|salvo|success|created/i
): Promise<void> {
  const toast = page
    .locator('[data-sonner-toast], [role="status"]')
    .filter({ hasText: msgRegex })
    .first();
  await expect(toast).toBeVisible({ timeout: 8_000 });
}

/** Localiza row na tabela por texto único (nome). */
export function findRowByText(page: Page, text: string) {
  return page.locator('table tbody tr', { hasText: text }).first();
}

/** Click delete + confirm. Lida com ConfirmDialog ou AlertDialog. */
export async function deleteRowByText(page: Page, rowText: string): Promise<void> {
  const row = findRowByText(page, rowText);
  await expect(row).toBeVisible({ timeout: 8_000 });
  // Open row actions menu (3 dots, kebab) ou click delete direto
  const menuTrigger = row.locator('button[aria-haspopup="menu"], [data-state="closed"]').first();
  if ((await menuTrigger.count()) > 0) {
    await menuTrigger.click();
    const deleteItem = page
      .getByRole('menuitem', { name: /excluir|deletar|remover|delete/i })
      .first();
    await deleteItem.click();
  } else {
    const deleteBtn = row.getByRole('button', { name: /excluir|deletar|remover|delete/i }).first();
    await deleteBtn.click();
  }
  // Confirm dialog
  const confirm = page
    .getByRole('button', { name: /confirmar|excluir|sim|confirm|delete/i })
    .last();
  await confirm.click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}
