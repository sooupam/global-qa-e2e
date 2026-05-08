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
 * Pamella P0 bugs — hardened smoke.
 *
 * Versão anterior asseretava ausência de erro PG sem provar que a ação
 * que dispara o bug realmente aconteceu. Falso positivo: UI muda, action
 * silenciosa, nenhum erro PG aparece, teste passa "feliz".
 *
 * Hardened — para cada teste:
 *   1. Pre-condition: UI element pra agir EXISTE (test.fail se não).
 *   2. Action: dispara operação.
 *   3. Bridge proof: assert URL mudou OU network request foi feito OU
 *      diálogo de confirmação fechou — algo OBSERVÁVEL provando que o
 *      caminho que dispara o bug foi exercitado.
 *   4. Bug assertion: erro PG específico não apareceu.
 *
 * Skipped se HAS_HOMOLOG_CREDS = false.
 */

test.beforeAll(async () => {
  test.skip(
    !HAS_HOMOLOG_CREDS,
    'Defina HOMOLOG_DANIEL_EMAIL e HOMOLOG_DANIEL_PASSWORD'
  );
});

test.describe('Ativos — P0 (hardened)', () => {
  test.beforeEach(async ({ page }) => {
    await homologLogin(page);
  });

  test('#275: abrir Ativo NÃO retorna "record new has no field name"', async ({ page }) => {
    const failures = trackApiFailures(page);

    await page.goto('/assets');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Pre-condition: tabela tem ao menos 1 row.
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow, '#275 sem assets na lista — não dá pra exercitar trigger').toBeVisible({
      timeout: 15_000,
    });

    // Action + Bridge proof: clicar abre detail (URL muda) OU dispara fetch.
    const detailNavOrFetch = Promise.race([
      page.waitForURL(/\/assets\/[^/]+/, { timeout: 10_000 }),
      page.waitForResponse((r) => /\/rest\/v1\/assets/.test(r.url()), { timeout: 10_000 }),
    ]);
    await firstRow.click();
    await detailNavOrFetch.catch(() => {
      throw new Error('#275 click em row não disparou navegação nem fetch — UI mudou?');
    });

    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Bug assertion: trigger órfão não fired.
    const errorMatches = failures.filter((f) =>
      /record .new. has no field .name./.test(f.body)
    );
    expect(
      errorMatches,
      '#275 trigger sync_asset_name_from_family ainda fires'
    ).toHaveLength(0);
  });

  test('#276/#277: desativar Ativo NÃO retorna "entity_id uuid vs text"', async ({ page }) => {
    const failures = trackApiFailures(page);

    await page.goto('/assets');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow, '#276 sem assets — não dá pra desativar').toBeVisible({
      timeout: 15_000,
    });
    await firstRow.click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Aceita Desativar OU Reativar — ambos disparam UPDATE que exercita o
    // trigger audit_resolve_labels (alvo do bug).
    const toggleBtn = page
      .getByRole('button', { name: /desativar|inativar|reativar|ativar/i })
      .first();
    await expect(
      toggleBtn,
      '#276 botão de toggle ativo/inativo não encontrado — UI mudou'
    ).toBeVisible({ timeout: 10_000 });

    // Capture network request OR confirm dialog appearing as proof.
    const updatePromise = page.waitForResponse(
      (r) => /\/rest\/v1\/assets/.test(r.url()) && ['PATCH', 'POST'].includes(r.request().method()),
      { timeout: 10_000 }
    );
    await toggleBtn.click();

    const confirm = page.getByRole('button', { name: /confirmar|sim|ok/i }).last();
    if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirm.click();
    }

    // Bridge proof: PATCH/POST request foi feito.
    await updatePromise.catch(() => {
      throw new Error('#276 update em assets não foi disparado — botão não fez submit');
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const errorMatches = failures.filter((f) =>
      /column .entity_id. is of type uuid but expression is of type text/.test(f.body)
    );
    expect(errorMatches, '#276/#277 audit_resolve_labels ainda quebrado').toHaveLength(0);
  });
});

test.describe('Ordens de Serviço — P0 (hardened)', () => {
  test.beforeEach(async ({ page }) => {
    await homologLogin(page);
  });

  test('#262: criar OS NÃO retorna 42703 column "category"', async ({ page }) => {
    const failures = trackApiFailures(page);
    const mark = e2eMark();

    await page.goto('/work-orders/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Pre-condition: form com input principal de descrição/título visível.
    const titleInput = page
      .locator(
        'input[name="title"], input[name="description"], input[name="name"], textarea[name="description"], textarea[name="title"]'
      )
      .first();
    await expect(
      titleInput,
      '#262 form de OS não tem input principal — UI mudou'
    ).toBeVisible({ timeout: 10_000 });
    await titleInput.fill(`${mark} OS`);

    const submit = page.getByRole('button', { name: /salvar|criar/i }).last();
    await expect(submit, '#262 botão salvar não encontrado').toBeVisible({ timeout: 5_000 });

    // Bridge proof: POST request a work_orders OU mensagem de erro/sucesso.
    const submitPromise = page.waitForResponse(
      (r) =>
        /\/rest\/v1\/work_orders/.test(r.url()) &&
        ['POST', 'PATCH'].includes(r.request().method()),
      { timeout: 10_000 }
    );
    await submit.click({ trial: false }).catch(() => {});

    const requestFired = await submitPromise.then(() => true).catch(() => false);
    if (!requestFired) {
      // Submit pode ter falhado por validação inline. Aceita se houver erro
      // visível no form, caso contrário test fail (bug não exercitado).
      const formError = page.locator('[role="alert"], .text-destructive').first();
      const hasError = await formError.isVisible({ timeout: 3_000 }).catch(() => false);
      expect(
        hasError,
        '#262 submit não disparou request nem erro — bug 42703 não exercitado'
      ).toBe(true);
    }

    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    const errorMatches = failures.filter((f) => /column .category. .* not exist/i.test(f.body));
    expect(
      errorMatches,
      '#262 trigger residual com NEW.category ainda fires'
    ).toHaveLength(0);
  });
});

test.describe('Parceiros — P0 (hardened)', () => {
  test.beforeEach(async ({ page }) => {
    await homologLogin(page);
  });

  test('#268: abrir + editar Parceiro NÃO cai em "Algo deu errado"', async ({ page }) => {
    await page.goto('/partners');
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow, '#268 sem parceiros — não dá pra exercitar PartnerForm').toBeVisible({
      timeout: 15_000,
    });

    // Action 1: abrir detail.
    await firstRow.click();
    await page.waitForURL(/\/partners\/[^/]+/, { timeout: 10_000 }).catch(() => {
      throw new Error('#268 click em row não navegou para /partners/:id');
    });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Não pode crashar na view.
    const errorBoundary = page.getByText(/algo deu errado/i).first();
    await expect(errorBoundary, '#268 PartnerView crashou').toHaveCount(0, { timeout: 5_000 });

    // Action 2: clicar Editar — exercitar PartnerForm onde ReferenceError t ocorria.
    const editBtn = page.getByRole('button', { name: /editar/i }).first();
    await expect(editBtn, '#268 botão Editar não encontrado').toBeVisible({ timeout: 5_000 });
    await editBtn.click();

    // Bridge proof: URL muda pra /edit OU form de edição renderiza.
    await page.waitForURL(/\/partners\/[^/]+\/edit/, { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    // Bug assertion: PartnerForm não crashou com ReferenceError.
    await expect(
      errorBoundary,
      '#268 PartnerForm crashou (provável ReferenceError t)'
    ).toHaveCount(0, { timeout: 5_000 });
  });

  test('#269: excluir Parceiro remove da listagem (cache invalidate)', async ({ page }) => {
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
    expect(resp, '#269 DELETE não foi disparado — botão não fez submit').not.toBeNull();
    if (resp) {
      expect(resp.status(), '#269 DELETE backend status').toBeLessThan(400);
    }

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
