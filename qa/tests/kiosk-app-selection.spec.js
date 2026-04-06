const { test, expect } = require('@playwright/test');

test.use({ storageState: 'auth.json' });

test('Kiosk — GET_APPS retorna lista completa mesmo com kiosk ativo', async ({ page }) => {
  // 1. Navegar direto para device API34 pelo ID (memory: project_emulators.md)
  const API34_ID = '1f031366-6c3f-45ae-95ed-88814167d41c';
  await page.goto(`/devices/${API34_ID}`);
  await page.waitForLoadState('networkidle');
  console.log('Device page:', page.url());

  // 2. Abrir modal Kiosk
  const kioskBtn = page.locator('button').filter({ hasText: /Kiosk/i }).first();
  await kioskBtn.click();
  await expect(page.locator('text=Modo Kiosk')).toBeVisible({ timeout: 5000 });

  // 3. Ativar toggle se não estiver ativo
  const toggle = page.locator('button').filter({ has: page.locator('span.rounded-full') }).first();
  const bgClass = await toggle.getAttribute('class');
  if (!bgClass?.includes('bg-purple')) await toggle.click();
  await expect(page.locator('text=Configurar apps')).toBeVisible({ timeout: 3000 });

  // 4. Buscar apps (ROUND 1 — kiosk pode estar ativo ou não)
  await page.locator('button').filter({ hasText: /Buscar Apps/i }).click();
  await expect(page.locator('text=/\\d+ apps encontrados/i')).toBeVisible({ timeout: 30000 });

  const countText1 = await page.locator('text=/\\d+ apps encontrados/i').textContent();
  const count1 = parseInt((countText1 || '').match(/\d+/)?.[0] || '0');
  console.log(`Round 1 — apps encontrados: ${count1}`);
  expect(count1).toBeGreaterThan(1);

  // 5. Selecionar 1 app e ativar kiosk
  const firstApp = page.locator('label').filter({ has: page.locator('input[type="checkbox"]') }).first();
  const firstAppName = await firstApp.locator('p.font-medium').textContent();
  await firstApp.click();
  console.log(`App selecionado: ${firstAppName}`);

  await page.locator('button').filter({ hasText: /Ativar Kiosk/i }).click();
  await expect(page.locator('text=/enviado com sucesso/i')).toBeVisible({ timeout: 10000 });
  console.log('Kiosk ativado — aguardando device processar...');

  // 6. Aguardar device processar o comando
  await page.waitForTimeout(12000);

  // 7. Reabrir modal Kiosk
  const kioskBtn2 = page.locator('button').filter({ hasText: /Kiosk/i }).first();
  await kioskBtn2.click();
  await expect(page.locator('text=Modo Kiosk')).toBeVisible({ timeout: 5000 });

  // 8. Ativar toggle
  const toggle2 = page.locator('button').filter({ has: page.locator('span.rounded-full') }).first();
  const bgClass2 = await toggle2.getAttribute('class');
  if (!bgClass2?.includes('bg-purple')) await toggle2.click();

  // 9. Buscar apps novamente (ROUND 2 — kiosk ativo)
  await page.locator('button').filter({ hasText: /Buscar Apps/i }).click();
  await expect(page.locator('text=/\\d+ apps encontrados/i')).toBeVisible({ timeout: 30000 });

  const countText2 = await page.locator('text=/\\d+ apps encontrados/i').textContent();
  const count2 = parseInt((countText2 || '').match(/\d+/)?.[0] || '0');
  console.log(`Round 2 (kiosk ativo) — apps encontrados: ${count2}`);

  // VERIFICAÇÃO PRINCIPAL: deve retornar lista completa, não só 1 app
  expect(count2).toBeGreaterThan(1);
  console.log(`✅ Fix OK: ${count1} apps (antes) → ${count2} apps (depois, kiosk ativo)`);

  // 10. Cleanup: desativar kiosk
  const disableBtn = page.locator('button').filter({ hasText: /Desativar Kiosk/i });
  if (await disableBtn.isVisible() && await disableBtn.isEnabled()) {
    await disableBtn.click();
    console.log('Kiosk desativado (cleanup)');
  } else {
    await page.locator('button').filter({ hasText: /Cancelar/i }).click();
  }
});
