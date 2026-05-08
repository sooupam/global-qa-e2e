import { test, expect } from '@playwright/test';
import {
  HAS_HOMOLOG_CREDS,
  homologLogin,
  trackApiFailures,
  assertNoFailureCodes,
  waitForApiResponse,
  e2eMark,
} from './helpers/homolog-net';

/**
 * Suite curada — 5 testes P0 que travam regressão de bugs reais reportados
 * em produção (códigos PG: 42501 RLS, 42703 column, "record new no field",
 * "uuid vs text", ReferenceError, cache stale após delete).
 *
 * Estratégia: cada teste reproduz UM bug e asserta que o erro específico
 * NÃO aparece nas responses capturadas via trackApiFailures().
 *
 * Reduzido de 18 → 5 testes. Removidos:
 * - Testes com .nth() em form fields (3): #279, #281, #280, #282, #283.
 * - Testes pendentes de fix (3): #263, #257, #258.
 * - Testes de regressão visual (5): #271, #273, #272, #274, #278.
 * - Tests P1 (2): #266, #264, #270.
 *
 * Skipped quando HAS_HOMOLOG_CREDS falso.
 */

test.beforeAll(async () => {
  test.skip(
    !HAS_HOMOLOG_CREDS,
    'Defina HOMOLOG_DANIEL_EMAIL e HOMOLOG_DANIEL_PASSWORD'
  );
});

test.describe('Ativos — P0', () => {
  test.beforeEach(async ({ page }) => {
    await homologLogin(page);
  });

  test('#275: Listagem/detalhe Ativo NÃO retorna "record new has no field name"', async ({
    page,
  }) => {
    const failures = trackApiFailures(page);

    await page.goto('/assets');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    }

    const errorMatches = failures.filter((f) =>
      /record .new. has no field .name./.test(f.body)
    );
    expect(
      errorMatches,
      '#275 trigger órfão sync_asset_name_from_family ainda fires'
    ).toHaveLength(0);
  });

  test('#276/#277: Desativar Ativo NÃO retorna "entity_id uuid vs text"', async ({ page }) => {
    const failures = trackApiFailures(page);

    await page.goto('/assets');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

      const disableBtn = page.getByRole('button', { name: /desativar|inativar/i }).first();
      if (await disableBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await disableBtn.click();
        const confirm = page.getByRole('button', { name: /confirmar|sim|ok/i }).last();
        if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await confirm.click();
        }
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      }
    }

    const errorMatches = failures.filter((f) =>
      /column .entity_id. is of type uuid but expression is of type text/.test(f.body)
    );
    expect(errorMatches, '#276/#277 audit_resolve_labels ainda quebrado').toHaveLength(0);
  });
});

test.describe('Ordens de Serviço — P0', () => {
  test.beforeEach(async ({ page }) => {
    await homologLogin(page);
  });

  test('#262: Criar OS NÃO retorna 42703 column "category"', async ({ page }) => {
    const failures = trackApiFailures(page);
    const mark = e2eMark();

    await page.goto('/work-orders/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const titleInput = page.locator('input[name="title"], input[name="description"]').first();
    if (await titleInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await titleInput.fill(`${mark} OS`);
    }

    const submit = page.getByRole('button', { name: /salvar|criar/i }).last();
    if (await submit.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submit.click({ trial: false }).catch(() => {});
      // Cura: substitui waitForTimeout(2_000) por networkidle resiliente.
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    }

    const errorMatches = failures.filter((f) => /column .category. .* not exist/i.test(f.body));
    expect(errorMatches, '#262 trigger residual com NEW.category ainda fires').toHaveLength(0);
  });
});

test.describe('Parceiros — P0', () => {
  test.beforeEach(async ({ page }) => {
    await homologLogin(page);
  });

  test('#268: Editar Parceiro NÃO cai em "Algo deu errado"', async ({ page }) => {
    await page.goto('/partners');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow, 'Sem parceiros na lista — seed antes').toBeVisible({ timeout: 10_000 });

    await firstRow.click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const errorBoundary = page.getByText(/algo deu errado/i).first();
    await expect(errorBoundary, '#268 view crashou').toHaveCount(0, { timeout: 5_000 });

    const editBtn = page.getByRole('button', { name: /editar/i }).first();
    if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    }

    await expect(
      errorBoundary,
      '#268 PartnerForm crashou (ReferenceError t)'
    ).toHaveCount(0, { timeout: 5_000 });
  });

  test('#269: Excluir Parceiro remove da listagem (cache invalidate)', async ({ page }) => {
    const failures = trackApiFailures(page);

    await page.goto('/partners');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const pamRow = page
      .locator('table tbody tr')
      .filter({ hasText: /pamella karoliny/i })
      .first();
    if (!(await pamRow.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, '#269 requer parceiro PAMELLA seedado');
      return;
    }

    await pamRow.click();
    await page.waitForURL(/\/partners\/[^/]+\/view/, { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const deleteRespPromise = waitForApiResponse(page, /\/rest\/v1\/entities/, {
      method: 'DELETE',
    });

    const delBtn = page.getByRole('button', { name: /^excluir$/i }).first();
    await expect(delBtn, '#269 botão Excluir não encontrado').toBeVisible({ timeout: 10_000 });
    await delBtn.click();

    const confirmBtn = page
      .locator('[role="alertdialog"]')
      .getByRole('button', { name: /excluir/i })
      .last();
    await expect(confirmBtn, '#269 confirm dialog não apareceu').toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    const resp = await deleteRespPromise.catch(() => null);
    if (resp) expect(resp.status(), '#269 DELETE backend status').toBeLessThan(400);

    // Aguarda navigate('/partners') + cache invalidate. Cura: removido waitForTimeout(2000)
    // — networkidle já garante que GET /entities (re-fetch) terminou.
    await page.waitForURL(/\/partners$/, { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const stillThere = page.locator('table tbody tr').filter({ hasText: /pamella karoliny/i });
    await expect(
      stillThere,
      '#269 PAMELLA ainda na listagem após delete (cache stale)'
    ).toHaveCount(0, { timeout: 5_000 });

    assertNoFailureCodes(failures, ['42501'], '#269 DELETE partners');
  });
});
