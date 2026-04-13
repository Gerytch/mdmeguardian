const { test, expect } = require('@playwright/test');

const BACKEND = 'http://localhost:3001';

// Login once via API, inject token into localStorage for each test (avoid throttle)
test.describe('Minha Conta', () => {
  let loginData;

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/v1/auth/login`, {
      data: { email: 'admin@eguardian.com', password: 'Admin@123' },
    });
    loginData = await res.json();
  });

  test.beforeEach(async ({ page }) => {
    // Inject full session into localStorage without hitting login UI (avoids throttle)
    await page.goto('/login');
    await page.evaluate((data) => {
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('tenantId', data.user.tenantId);
    }, loginData);
    await page.goto('/conta');
    await page.waitForURL('**/conta**', { timeout: 5000 });
  });

  test('sidebar exibe link Minha Conta', async ({ page }) => {
    await expect(page.locator('text=Minha Conta').first()).toBeVisible();
  });

  test('página /conta carrega perfil do usuário', async ({ page }) => {
    await expect(page.locator('h1', { hasText: 'Minha Conta' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Perfil' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Alterar Senha' })).toBeVisible();
    await expect(page.locator('.w-12.h-12.rounded-full')).toBeVisible();
  });

  test('formulário de senha valida campos obrigatórios', async ({ page }) => {
    await page.fill('input[placeholder="••••••••"]', 'SenhaAtual@1');
    await page.fill('input[placeholder="Mínimo 8 caracteres"]', 'NovaSenha@1');
    await page.fill('input[placeholder="Repita a nova senha"]', 'SenhaDiferente@1');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=não coincidem')).toBeVisible();
  });

  test('formulário de senha valida mínimo 8 caracteres', async ({ page }) => {
    await page.fill('input[placeholder="••••••••"]', 'SenhaAtual@1');
    await page.fill('input[placeholder="Mínimo 8 caracteres"]', 'curta');
    await page.fill('input[placeholder="Repita a nova senha"]', 'curta');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=8 caracteres')).toBeVisible();
  });

  test('senha atual incorreta exibe mensagem de erro', async ({ page }) => {
    await page.fill('input[placeholder="••••••••"]', 'SenhaErrada@999');
    await page.fill('input[placeholder="Mínimo 8 caracteres"]', 'NovaSenha@123');
    await page.fill('input[placeholder="Repita a nova senha"]', 'NovaSenha@123');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Senha atual incorreta')).toBeVisible({ timeout: 8000 });
  });

  test('link Minha Conta na sidebar está ativo na página /conta', async ({ page }) => {
    // O link "Minha Conta" deve ter a classe de item ativo (bg-primary-600)
    const link = page.locator('a[href="/conta"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveClass(/bg-primary-600/);
  });
});
