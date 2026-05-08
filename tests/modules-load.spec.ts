import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';
import { waitForApp } from './helpers/navigation';

/**
 * Smoke: Module boot loop.
 *
 * Cobre as 7 rotas core CMMS num único teste com `test.step`. Não valida
 * conteúdo específico (UI muda) — só asserta que cada módulo:
 *   1. Não caiu em error boundary do React ("algo deu errado").
 *   2. Não redirecionou para /login (sessão preservada).
 *
 * Detecta colapso de bundle/route, regressão grave em hook de domínio,
 * RLS quebrada em alguma página. NÃO detecta bugs de UI específica —
 * isso é regressão, não smoke.
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

test.describe('Module boot — smoke', () => {
  test.setTimeout(120_000);

  test('módulos críticos carregam sem error boundary nem perda de sessão', async ({ page }) => {
    await loginAs(page, TEST_USERS.admin.email);
    await waitForApp(page);

    for (const { path, name } of MODULES) {
      await test.step(name, async () => {
        await page.goto(path);
        const errorBoundary = page.getByText(/algo deu errado|something went wrong/i).first();
        await expect(errorBoundary, `${name} caiu em error boundary`).toHaveCount(0, {
          timeout: 5_000,
        });
        await expect(page, `${name} redirecionou para /login`).not.toHaveURL(/\/login/, {
          timeout: 1_000,
        });
      });
    }
  });
});
