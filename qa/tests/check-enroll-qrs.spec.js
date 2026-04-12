const { test } = require('@playwright/test');

test('check provisioning QR on enroll page', async ({ page }) => {
  await page.goto('http://56.125.80.141/login');
  await page.fill('input[type="email"]', 'admin@eguardian.com');
  await page.fill('input[type="password"]', 'Admin@123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 10000 });

  await page.goto('http://56.125.80.141/enroll');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'results/enroll-top.png', fullPage: false });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'results/enroll-bottom.png', fullPage: false });
  await page.screenshot({ path: 'results/enroll-full.png', fullPage: true });

  const qrImages = await page.locator('img[alt*="QR"]').count();
  console.log('QR images found:', qrImages);

  const provisioningTitle = await page.locator('text=Provisionamento Empresarial').count();
  console.log('Provisioning section found:', provisioningTitle);
});
