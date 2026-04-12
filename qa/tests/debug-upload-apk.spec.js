const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Debug — Upload APK', () => {
  test('captura erro exato no upload do agente', async ({ page }) => {
    // Login
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.locator('input').nth(0).fill('admin@eguardian.com');
    await page.locator('input').nth(1).fill('Admin@123');
    await page.locator('button').filter({ hasText: /entrar|login/i }).click();
    await page.waitForTimeout(3000);
    console.log('URL após login:', page.url());

    // Interceptar todas as respostas de upload
    const uploadResponses = [];
    page.on('response', async (response) => {
      if (response.url().includes('/upload')) {
        let body = '';
        try { body = await response.text(); } catch {}
        uploadResponses.push({
          url: response.url(),
          status: response.status(),
          body,
        });
        console.log(`UPLOAD RESPONSE: ${response.status()} — ${response.url()}`);
        console.log(`BODY: ${body}`);
      }
    });

    // Interceptar erros de rede
    page.on('requestfailed', (request) => {
      if (request.url().includes('/upload')) {
        console.log(`REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText}`);
      }
    });

    // Navegar para /devices
    await page.goto(`${BASE_URL}/devices`);
    await page.waitForLoadState('networkidle');

    // Abrir modal Atualizar Agente
    const btn = page.getByRole('button', { name: /atualizar agente/i });
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(1000);

    // Criar APK falso mínimo para o teste
    const tmpApk = path.join(require('os').tmpdir(), 'test-agent.apk');
    fs.writeFileSync(tmpApk, Buffer.alloc(1024, 0x50)); // 1KB dummy

    // Aguardar carregamento do modal (pode mostrar "Carregando..." primeiro)
    await page.waitForTimeout(2000);

    // Fazer upload — funciona tanto no estado vazio quanto no estado "Trocar"
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpApk, { timeout: 10000 });
    await page.waitForTimeout(4000);

    // Verificar estado do modal
    const errorMsg = page.locator('text=Erro ao fazer upload');
    const successMsg = page.locator('text=APK armazenado');

    if (await errorMsg.isVisible()) {
      console.log('❌ Upload falhou — verificando respostas capturadas...');
      console.log(JSON.stringify(uploadResponses, null, 2));

      // Falha o teste com os detalhes
      const details = uploadResponses.length > 0
        ? `HTTP ${uploadResponses[0].status}: ${uploadResponses[0].body}`
        : 'Nenhuma resposta HTTP capturada — requisição pode ter sido bloqueada antes de chegar ao backend';

      throw new Error(`Upload falhou:\n${details}`);
    } else {
      console.log('✅ Upload funcionando corretamente');
    }
  });
});
