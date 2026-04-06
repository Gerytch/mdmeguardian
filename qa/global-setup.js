const { chromium } = require('@playwright/test');

module.exports = async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000/login');
  await page.fill('input[type="email"]', 'admin@eguardian.com');
  await page.fill('input[type="password"]', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 10000 });

  await page.context().storageState({ path: 'auth.json' });
  await browser.close();
  console.log('✅ Login realizado, sessão salva em auth.json');
};
