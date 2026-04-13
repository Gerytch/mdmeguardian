const { test, expect } = require('@playwright/test');

const BACKEND = 'http://localhost:3099';

test.describe('Single-Tenant — Registro desabilitado', () => {

  test('POST /auth/register retorna 410 Gone', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/v1/auth/register`, {
      data: { companyName: 'Empresa Teste', email: 'novo@empresa.com', password: 'Senha@123' },
    });
    expect(res.status()).toBe(410);
    const body = await res.json();
    expect(body.message).toContain('disabled');
  });

  test('/register no frontend redireciona para /login', async ({ page }) => {
    await page.goto('/register');
    await page.waitForURL('**/login**', { timeout: 5000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('login ainda funciona normalmente', async ({ request }) => {
    const res = await request.post(`http://localhost:3001/api/v1/auth/login`, {
      data: { email: 'admin@eguardian.com', password: 'Admin@123' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user.tenantId).toBe('2c55c328-daa0-4342-9ec9-b36864264878');
  });

});
