const { test, expect } = require('@playwright/test');

test('debug login on homolog EC2', async ({ page }) => {
  // Captura todas as respostas de API
  const apiResponses = [];
  page.on('response', async response => {
    if (response.url().includes('/api/v1/auth')) {
      let body = '';
      try { body = await response.text(); } catch {}
      apiResponses.push({
        url: response.url(),
        status: response.status(),
        body,
      });
    }
  });

  // Captura erros de console
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('http://56.125.80.141/auth/login');
  await page.waitForLoadState('networkidle');

  // Preenche e envia login
  await page.fill('input[type="email"], input[name="email"]', 'admin@eguardian.com');
  await page.fill('input[type="password"], input[name="password"]', 'Admin@123');
  await page.click('button[type="submit"]');

  // Aguarda resposta
  await page.waitForTimeout(3000);

  const currentUrl = page.url();

  console.log('\n=== DEBUG LOGIN HOMOLOG ===');
  console.log('URL após login:', currentUrl);
  console.log('\n--- Respostas da API ---');
  for (const r of apiResponses) {
    console.log(`[${r.status}] ${r.url}`);
    console.log('Body:', r.body.slice(0, 500));
  }
  console.log('\n--- Erros de Console ---');
  for (const e of consoleErrors) {
    console.log('ERROR:', e);
  }

  // Salva screenshot
  await page.screenshot({ path: 'results/debug-login-homolog.png', fullPage: true });
  console.log('\nScreenshot: results/debug-login-homolog.png');
});
