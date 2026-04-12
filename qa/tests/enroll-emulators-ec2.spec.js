const { test } = require('@playwright/test');
const { execSync } = require('child_process');

const BASE = 'http://56.125.80.141';
const ADB = 'C:/Users/elias/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const EMULATORS = ['emulator-5554', 'emulator-5556', 'emulator-5558', 'emulator-5560'];

test('enroll all emulators on EC2', async ({ page }) => {
  // Login
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', 'admin@eguardian.com');
  await page.fill('input[type="password"]', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 10000 });
  console.log('✓ Logado no EC2');

  // Captura token da API de enrollment
  let enrollToken = null;
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('enrollment') || url.includes('enroll')) {
      try {
        const body = await response.json();
        const token = body?.token || body?.enrollmentToken || body?.data?.token;
        if (token) { enrollToken = token; console.log('✓ Token capturado:', token.slice(0, 20) + '...'); }
      } catch {}
    }
  });

  await page.goto(`${BASE}/enroll`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  if (!enrollToken) {
    // Tenta gerar novo QR
    const btn = page.locator('button:has-text("Gerar novo QR"), button:has-text("Gerar")').first();
    await btn.click();
    await page.waitForTimeout(2000);
  }

  console.log('\nToken final:', enrollToken);

  if (!enrollToken) {
    console.log('✗ Não conseguiu capturar o token. Verifique o screenshot.');
    await page.screenshot({ path: 'results/enroll-debug.png', fullPage: true });
    return;
  }

  // Enrolla todos os emuladores com o mesmo token (cada um cria um device novo)
  console.log('\n=== ENROLLMENT VIA ADB ===');
  for (const serial of EMULATORS) {
    const cmd = `"${ADB}" -s ${serial} shell am start -n "com.mdm.enterprise.homolog/com.mdm.enterprise.ui.MainActivity" -a DEV_ENROLL --es dev_device_token "${enrollToken}" --es dev_api_url "${BASE}/api/v1"`;
    try {
      execSync(cmd, { encoding: 'utf8' });
      console.log(`✓ ${serial} — enrollment iniciado`);
    } catch (e) {
      console.log(`✗ ${serial} — erro: ${e.message}`);
    }
    await page.waitForTimeout(3000);

    // Gera novo token para o próximo emulador
    if (EMULATORS.indexOf(serial) < EMULATORS.length - 1) {
      enrollToken = null;
      const btn = page.locator('button:has-text("Gerar novo QR"), button:has-text("Gerar")').first();
      await btn.click();
      await page.waitForTimeout(2000);
    }
  }

  console.log('\n✅ Verifique os devices em:', BASE + '/devices');
  await page.goto(`${BASE}/devices`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'results/devices-after-enroll.png', fullPage: true });
});
