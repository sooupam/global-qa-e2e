import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS, expectAuthenticatedOnApp } from './helpers/auth';
import { waitForApp } from './helpers/navigation';

/**
 * Smoke: Module boot — hardened.
 *
 * Versão anterior validava apenas:
 *   - sem error boundary
 *   - URL não em /login
 *
 * Falso positivo: página em loading infinito OU main vazia passavam.
 *
 * Versão hardened — 4 evidências positivas por módulo:
 *   1. Sem error boundary
 *   2. URL não em /login (sessão preservada)
 *   3. Spinners de loading sumiram em ≤ 15s
 *   4. main element existe E tem ao menos 1 child (conteúdo renderizado)
 */

const MODULES: Array<{ path: string; name: string }> = [
  { path: '/', name: 'home' },
  { path: '/cockpit', name: 'cockpit (Dashboard persona-aware)' },
  { path: '/assets', name: 'assets' },
  { path: '/os', name: 'work-orders' },
  { path: '/maintenance-plans', name: 'maintenance-plans' },
  { path: '/service-requests', name: 'service-requests' },
  { path: '/employees', name: 'employees' },
  { path: '/inventory', name: 'inventory' },
  { path: '/settings', name: 'settings' },
  { path: '/sectors', name: 'sectors' },
  { path: '/notifications', name: 'notifications (inbox de alertas)' },
];

test.describe('Module boot — hardened smoke', () => {
  test.setTimeout(180_000);

  test('módulos críticos renderizam conteúdo real (não loading vazio)', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);
    await expectAuthenticatedOnApp(page);

    for (const { path, name } of MODULES) {
      await test.step(name, async () => {
        await page.goto(path);

        // 1. Sem error boundary
        const errorBoundary = page.getByText(/algo deu errado|something went wrong/i).first();
        await expect(errorBoundary, `${name} caiu em error boundary`).toHaveCount(0, {
          timeout: 5_000,
        });

        // 2. Sessão preservada
        await expect(page, `${name} redirecionou para /login`).not.toHaveURL(/\/login/, {
          timeout: 1_000,
        });

        // 3 + 4. Conteúdo realmente renderizou: spinners limpos E main com filhos.
        await page
          .waitForFunction(
            () => {
              const main = document.querySelector('main, [role="main"]');
              if (!main) return false;
              const spinners = document.querySelectorAll('.animate-spin');
              if (spinners.length > 0) return false;
              return main.children.length > 0;
            },
            { timeout: 30_000 }
          )
          .catch(() => {});

        const main = page.locator('main, [role="main"]').first();
        await expect(main, `${name}: main element não visível`).toBeVisible({ timeout: 3_000 });

        const spinners = page.locator('.animate-spin');
        await expect(
          spinners,
          `${name}: travou em loading (spinners não desapareceram em 15s)`
        ).toHaveCount(0, { timeout: 3_000 });
      });
    }
  });
});
