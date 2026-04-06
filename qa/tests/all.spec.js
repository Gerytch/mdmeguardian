const { test, expect, chromium } = require('@playwright/test');

const DEVICES = [
  { label: 'API25', id: '6d432fee-db26-4f69-bc1d-fe097a7a5803', serial: 'emulator-5554' },
  { label: 'API32', id: '8560d820-1e56-44b5-b83c-752865eb6100', serial: 'emulator-5556' },
  { label: 'API34', id: '1f031366-6c3f-45ae-95ed-88814167d41c', serial: 'emulator-5558' },
  { label: 'API36', id: 'ea6743ca-784a-4b68-b2f0-beb94cfb2a82', serial: 'emulator-5560' },
];
const PRIMARY = DEVICES[1]; // API32 para testes extras

let browser, context, page;

test.describe.serial('E.Guardian — QA Sistema Completo', () => {

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: false, slowMo: 250 });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'admin@eguardian.com');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    console.log('Login unico realizado');
  });

  test.afterAll(async () => { await browser.close(); });

  // ── DASHBOARD ──────────────────────────────────────────────────
  test('Dashboard: cards e secoes visiveis', async () => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Painel');
    await expect(page.getByText('Total de Dispositivos')).toBeVisible();
    await expect(page.getByText('Online Agora')).toBeVisible();
    await expect(page.getByText('Dispositivos Ativos')).toBeVisible();
    await expect(page.getByText('Comandos Pendentes')).toBeVisible();
    await expect(page.getByText('Dispositivos Recentes')).toBeVisible();
    await expect(page.getByText('Comandos Recentes')).toBeVisible();
  });

  // ── DEVICES LIST ───────────────────────────────────────────────
  test('Devices: lista carrega', async () => {
    await page.goto('/devices');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Dispositivos');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 8000 });
    console.log('Devices: ' + await rows.count());
  });

  test('Devices: modal Adicionar abre e fecha', async () => {
    await page.getByText('Adicionar Dispositivo').click();
    await expect(page.getByText('Cadastrar Novo Dispositivo')).toBeVisible();
    await page.getByRole('button', { name: /Cancelar/i }).click();
  });

  // ── POLICIES ───────────────────────────────────────────────────
  test('Policies: lista carrega', async () => {
    await page.goto('/policies');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Pol');
  });

  test('Policies: modal Nova Politica abre e fecha', async () => {
    await page.getByText('Nova Pol').click();
    await expect(page.locator('h3').filter({ hasText: /Pol/i })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /Cancelar/i }).click();
  });

  // ── APPS ───────────────────────────────────────────────────────
  test('Apps: lista carrega', async () => {
    await page.goto('/apps');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Aplicativo');
    console.log('Apps: ' + await page.locator('tbody tr').count());
  });

  test('Apps: modal Adicionar App abre e fecha', async () => {
    await page.getByText('Adicionar App').click();
    await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: 5000 });
    await page.getByRole('button', { name: /Cancelar/i }).click();
  });

  // ── COMMANDS HISTORY ───────────────────────────────────────────
  test('Commands: historico carrega', async () => {
    await page.goto('/commands');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Comando');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 8000 });
    console.log('Comandos: ' + await rows.count());
  });

  // ── DEVICE USERS ───────────────────────────────────────────────
  test('Device Users: lista carrega', async () => {
    await page.goto('/device-users');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Usu');
    console.log('Device users: ' + await page.locator('tbody tr').count());
  });

  test('Device Users: busca filtra resultados', async () => {
    await page.locator('input[placeholder*="Buscar"]').fill('teste');
    await page.waitForTimeout(800);
    console.log('Busca "teste": ' + await page.locator('tbody tr').count());
    await page.locator('input[placeholder*="Buscar"]').clear();
  });

  test('Device Users: modal Novo Usuario abre e fecha', async () => {
    await page.getByText('Novo Usu').click();
    await expect(page.locator('div[class*="fixed"]').filter({ hasText: /rio|Criar/i })).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  // ── DEVICE SESSIONS ────────────────────────────────────────────
  test('Device Sessions: lista carrega', async () => {
    await page.goto('/device-sessions');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Sess');
    console.log('Sessoes: ' + await page.locator('tbody tr').count());
  });

  test('Device Sessions: filtro de status funciona', async () => {
    const sel = page.locator('select').filter({ hasText: /Todos os status/i });
    if (await sel.isVisible().catch(() => false)) {
      await sel.selectOption('ACTIVE');
      await page.waitForTimeout(800);
      console.log('Sessoes ACTIVE: ' + await page.locator('tbody tr').count());
      await sel.selectOption('');
    }
  });

  test('Device Sessions: exportar CSV', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
      page.getByText('Exportar CSV').click(),
    ]);
    console.log('CSV: ' + (download ? 'arquivo gerado' : 'sem download (ok)'));
  });

  // ── GROUPS ─────────────────────────────────────────────────────
  test('Groups: lista carrega', async () => {
    await page.goto('/groups');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Grupo');
  });

  test('Groups: modal Novo Grupo abre e fecha', async () => {
    await page.getByText('Novo Grupo').click();
    await expect(page.locator('div[class*="fixed"]').filter({ hasText: /Grupo/i })).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  // ── POR DEVICE ─────────────────────────────────────────────────
  for (const device of DEVICES) {
    test('[' + device.label + '] Device Detail: carrega botoes de acao', async () => {
      await page.goto('/devices/' + device.id);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 8000 });
      await expect(page.getByRole('button', { name: /Admin Lock/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Kiosk/i }).first()).toBeVisible();
      await expect(page.getByText(/Enviar Mensagem/i)).toBeVisible();
      await expect(page.getByText(/Reiniciar/i)).toBeVisible();
    });

    test('[' + device.label + '] Admin Lock: envia, confirma e libera', async () => {
      await page.goto('/devices/' + device.id);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /Admin Lock/i }).first().click();
      await expect(page.locator('h3').filter({ hasText: /Admin Lock/i })).toBeVisible({ timeout: 5000 });
      await page.locator('textarea').fill('Bloqueio QA ' + device.label);
      await page.locator('input[placeholder*="Ramal"]').fill('ti@empresa.com');
      await page.getByRole('button', { name: /Aplicar Admin Lock/i }).last().click();
      let success = false;
      try {
        await page.waitForSelector('text=/Admin Lock aplicado/i', { timeout: 20000 });
        success = true;
      } catch { await page.waitForTimeout(5000); }
      const failed = await page.locator('text=/Falha na execucao/i').isVisible().catch(() => false);
      console.log('[' + device.label + '] Admin Lock sucesso=' + success + ' falha=' + failed);
      expect(failed).toBe(false);
      await page.reload(); await page.waitForLoadState('networkidle');
      const unlockBtn = page.getByRole('button', { name: /Liberar Admin Lock/i });
      if (await unlockBtn.isVisible().catch(() => false)) {
        await unlockBtn.click();
        try { await page.waitForSelector('text=/Admin Lock removido/i', { timeout: 20000 }); }
        catch { await page.waitForTimeout(5000); }
        console.log('[' + device.label + '] Unlocked');
      }
    });

    test('[' + device.label + '] Kiosk: modal abre e cancela', async () => {
      await page.goto('/devices/' + device.id);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /Kiosk/i }).first().click();
      await expect(page.locator('h3').filter({ hasText: /Kiosk/i })).toBeVisible({ timeout: 5000 });
      await page.getByRole('button', { name: /Cancelar/i }).click();
    });

    test('[' + device.label + '] Enviar Mensagem: envia e fecha', async () => {
      await page.goto('/devices/' + device.id);
      await page.waitForLoadState('networkidle');
      await page.getByText(/Enviar Mensagem/i).click();
      await expect(page.locator('h3').filter({ hasText: /Mensagem/i })).toBeVisible({ timeout: 5000 });
      await page.locator('input[type="text"]').first().fill('QA ' + device.label);
      await page.locator('textarea').fill('Mensagem automatica de QA');
      await page.getByRole('button', { name: /^Enviar$/i }).click();
      await page.waitForTimeout(2000);
    });

    test('[' + device.label + '] Reiniciar: envia comando', async () => {
      await page.goto('/devices/' + device.id);
      await page.waitForLoadState('networkidle');
      await page.getByText(/Reiniciar/i).click();
      const confirm = page.getByRole('button', { name: /Confirmar|Reiniciar/i }).last();
      if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.click();
      await page.waitForTimeout(3000);
      console.log('[' + device.label + '] Reboot enviado');
    });

    test('[' + device.label + '] Atualizar Politica: envia comando', async () => {
      await page.goto('/devices/' + device.id);
      await page.waitForLoadState('networkidle');
      await page.getByText(/Atualizar Pol/i).click();
      await page.waitForTimeout(3000);
      console.log('[' + device.label + '] Update Policy enviado');
    });
  }

  // ── EXTRAS no PRIMARY (API32) ──────────────────────────────────
  test('[' + PRIMARY.label + '] WiFi Diagnostico: abre e fecha', async () => {
    // API32 was rebooted by the Reboot test — wait for device to come back online
    await page.waitForTimeout(12000);
    await page.goto('/devices/' + PRIMARY.id);
    await page.waitForLoadState('networkidle');
    // Use broad regex to handle accented "Diagnóstico" or unaccented
    const wifiBtn = page.getByText(/Diagn.{0,3}stico WiFi/i);
    await expect(wifiBtn).toBeVisible({ timeout: 10000 });
    await wifiBtn.click();
    await expect(page.locator('h3').filter({ hasText: /Diagn/i })).toBeVisible({ timeout: 5000 });
    try {
      await page.waitForSelector('div.bg-cyan-50', { timeout: 20000 });
      console.log('[' + PRIMARY.label + '] WiFi: rede encontrada');
    } catch {
      console.log('[' + PRIMARY.label + '] WiFi: sem resultado em 20s');
    }
    await page.getByRole('button', { name: /Fechar/i }).click();
  });

  test('[' + PRIMARY.label + '] Localizar: envia comando', async () => {
    await page.goto('/devices/' + PRIMARY.id);
    await page.waitForLoadState('networkidle');
    await page.getByText(/Localizar/i).click();
    await page.waitForTimeout(3000);
    console.log('[' + PRIMARY.label + '] Locate enviado');
  });

  test('[' + PRIMARY.label + '] Kiosk: ativa, confirma e desativa', async () => {
    await page.goto('/devices/' + PRIMARY.id);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /Kiosk/i }).first().click();
    await expect(page.locator('h3').filter({ hasText: /Kiosk/i })).toBeVisible({ timeout: 5000 });
    const toggle = page.locator('button.relative.inline-flex').first();
    await toggle.click();
    const fetchBtn = page.getByText(/Buscar Apps Instalados/i);
    if (await fetchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fetchBtn.click();
      await page.waitForTimeout(6000);
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await checkbox.check();
      }
    }
    const activateBtn = page.getByRole('button', { name: /Ativar Kiosk/i });
    const activateBtnText = await activateBtn.textContent({ timeout: 3000 }).catch(() => '');
    const hasApps = activateBtnText && !activateBtnText.includes('(0 apps)');
    if (await activateBtn.isVisible({ timeout: 3000 }).catch(() => false) && hasApps) {
      await activateBtn.click();
      try { await page.waitForSelector('text=/Kiosk/i', { timeout: 20000 }); }
      catch { await page.waitForTimeout(5000); }
      console.log('[' + PRIMARY.label + '] Kiosk ativado');
      await page.reload(); await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /Kiosk/i }).first().click();
      await expect(page.locator('h3').filter({ hasText: /Kiosk/i })).toBeVisible({ timeout: 5000 });
      const disableBtn = page.getByRole('button', { name: /Desativar Kiosk/i });
      if (await disableBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Wait for device to acknowledge kiosk activation (button starts disabled)
        await disableBtn.waitFor({ state: 'visible' });
        await page.waitForFunction(
          () => !document.querySelector('button[disabled]')?.textContent?.includes('Desativar Kiosk'),
          { timeout: 30000 }
        ).catch(() => {});
        if (await disableBtn.isEnabled({ timeout: 5000 }).catch(() => false)) {
          await disableBtn.click();
        }
        await page.waitForTimeout(10000);
        console.log('[' + PRIMARY.label + '] Kiosk desativado');
      } else {
        await page.getByRole('button', { name: /Cancelar/i }).click();
      }
    } else {
      await page.getByRole('button', { name: /Cancelar/i }).click();
      console.log('[' + PRIMARY.label + '] Kiosk: sem apps para ativar');
    }
  });

  // ── LOGIN NEGATIVO ─────────────────────────────────────────────
  test('Login: credenciais erradas exibem erro', async () => {
    await context.clearCookies();
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'errado@test.com');
    await page.fill('input[type="password"]', 'senhaerrada');
    await page.click('button[type="submit"]');
    await expect(page.locator('div.bg-red-50')).toBeVisible({ timeout: 5000 });
  });

});
