const { test, expect } = require('@playwright/test');

test.describe('Single-Tenant Login', () => {

  test('login page não exibe link "Cadastre sua empresa"', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Cadastre sua empresa')).not.toBeVisible();
    await expect(page.locator('text=Não tem uma conta')).not.toBeVisible();
    // Verifica que o formulário de login ainda está presente
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('/register redireciona para /login', async ({ page }) => {
    await page.goto('/register');
    await page.waitForURL('**/login**', { timeout: 5000 });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('login com credenciais válidas funciona normalmente', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@eguardian.com');
    await page.fill('input[type="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 10000 });
    await expect(page).toHaveURL(/dashboard/);
  });

});
