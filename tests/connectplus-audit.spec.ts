import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';

/**
 * ConnectPlus audit — valida render + presença de elementos críticos
 * pra gap analysis. NÃO testa ações destrutivas. Só smoke + screenshot.
 */

const HOSPITAL_SENSOR_ID = 'd7d54573-2a30-4f1b-bb5c-b3445c00e3ab';
const HOSPITAL_PROFILE_ID = 'd376eb16-aea2-4b45-abb9-6df3103f6f1f';
const HOSPITAL_TYPE_ID = 'bca63d95-a5fb-40a7-ad4b-97afef61eb33';

test.use({ baseURL: 'http://rededorpcm.localhost:8080' });

test.beforeEach(async ({ page }) => {
  await loginAs(page, 'daniel.rodrigues@globalthings.net');
});

test('1. Threshold profile edit — ProfileActionsSection presente', async ({ page }) => {
  await page.goto(`/connect/threshold-profiles/${HOSPITAL_PROFILE_ID}/edit`);
  await page.waitForLoadState('networkidle');
  // Heading do form
  await expect(page.getByText(/Editar perfil de threshold|Edit threshold profile/i)).toBeVisible();
  // Seção de ações
  const actionsHeader = page.getByText(/Ações/i).first();
  await expect(actionsHeader).toBeVisible();
  await page.screenshot({ path: 'e2e-out/01-profile-edit.png', fullPage: true });
});

test('2. Monitoring panel — SensorCard com threshold zone', async ({ page }) => {
  await page.goto('/connect/monitoring');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e-out/02-monitoring-list.png', fullPage: true });
  // Tenta abrir 1º painel se existir
  const firstPanel = page.locator('a[href^="/connect/monitoring/"]').first();
  if (await firstPanel.count()) {
    await firstPanel.click();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e-out/02b-monitoring-detail.png', fullPage: true });
  }
});

test('3. Automation flow — projeção read-only do threshold-profile', async ({ page }) => {
  await page.goto('/connect/automation');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e-out/03-automation-list.png', fullPage: true });
});

test('4. Sensor type edit — BooleanStateEditor com op/value/value2', async ({ page }) => {
  await page.goto(`/admin/connectplus/sensor-types/${HOSPITAL_TYPE_ID}/edit`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e-out/04-sensor-type-edit.png', fullPage: true });
  // Procura dropdown de operador (se categoria toggle ativada)
  const opSelect = page.locator('text=Quando o valor é').first();
  await expect(opSelect).toBeVisible({ timeout: 5_000 });
});

test('5. Alerts page — lista paginada + filtros', async ({ page }) => {
  await page.goto('/connect/alerts');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e-out/05-alerts.png', fullPage: true });
});

test('6. Escalation policies — UI cria/edita policy', async ({ page }) => {
  await page.goto('/connect/escalation-policies');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e-out/06-escalation.png', fullPage: true });
});

// Bonus: confirma sensor detail tem prediction toggle
test('7. Sensor detail — prediction toggle + anomaly UI', async ({ page }) => {
  await page.goto(`/connect/sensors/${HOSPITAL_SENSOR_ID}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'e2e-out/07-sensor-detail.png', fullPage: true });
});
