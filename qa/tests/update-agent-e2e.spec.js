const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
// APK real para garantir instalação válida no device
const APK_PATH = path.resolve(__dirname, '../../android/app/build/outputs/apk/homolog/app-homolog.apk');
const FAKE_VERSION = '9.9.9-test';

test.describe('UPDATE_AGENT — Fluxo E2E via Frontend', () => {
  test('upload APK + dispatch UPDATE_AGENT para device Samsung', async ({ page }) => {
    // ── Login ──────────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.locator('input').nth(0).fill('admin@eguardian.com');
    await page.locator('input').nth(1).fill('Admin@123');
    await page.locator('button').filter({ hasText: /entrar|login/i }).click();
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
    console.log('✅ Login OK');

    // ── Captura respostas de upload e comando ──────────────────────────────
    const uploadResponses = [];
    const commandResponses = [];
    page.on('response', async (response) => {
      if (response.url().includes('/upload')) {
        let body = '';
        try { body = await response.text(); } catch {}
        uploadResponses.push({ status: response.status(), body });
        console.log(`📤 UPLOAD: HTTP ${response.status()} — ${body.slice(0, 120)}`);
      }
      if (response.url().includes('/commands') && response.request().method() === 'POST') {
        let body = '';
        try { body = await response.text(); } catch {}
        commandResponses.push({ status: response.status(), body });
        console.log(`📡 COMMAND: HTTP ${response.status()} — ${body.slice(0, 200)}`);
      }
    });

    // ── Navegar para /devices ──────────────────────────────────────────────
    await page.goto(`${BASE_URL}/devices`);
    await page.waitForLoadState('networkidle');

    // ── Abrir modal Atualizar Agente ───────────────────────────────────────
    const btnAtualizar = page.getByRole('button', { name: /atualizar agente/i });
    await expect(btnAtualizar).toBeVisible({ timeout: 8000 });
    await btnAtualizar.click();
    await page.waitForTimeout(1500);
    console.log('✅ Modal Atualizar Agente aberto');

    // ── Upload do APK ──────────────────────────────────────────────────────
    console.log(`📦 Fazendo upload de ${path.basename(APK_PATH)} (${(fs.statSync(APK_PATH).size / 1024 / 1024).toFixed(1)}MB)...`);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(APK_PATH, { timeout: 15000 });

    // Aguarda o upload completar (mensagem de sucesso ou APK URL preenchida)
    await expect(page.locator('text=/APK armazenado|✓ APK/i')).toBeVisible({ timeout: 60000 });
    console.log('✅ Upload concluído');

    // ── Preencher versão fake ──────────────────────────────────────────────
    const versionInput = page.locator('input[placeholder="1.3.3"]');
    await versionInput.clear();
    await versionInput.fill(FAKE_VERSION);
    console.log(`✅ Versão preenchida: ${FAKE_VERSION}`);

    // "Todos os dispositivos" já vem selecionado por padrão (radio button)
    console.log('✅ "Todos os dispositivos" já selecionado');

    // ── Disparar UPDATE_AGENT ──────────────────────────────────────────────
    const btnDispatch = page.getByRole('button', { name: /despachar atualiza/i });
    await expect(btnDispatch).toBeEnabled({ timeout: 5000 });
    await btnDispatch.click();

    // ── Confirmar modal de atenção ─────────────────────────────────────────
    const btnConfirm = page.getByRole('button', { name: /confirmar e despachar/i });
    await expect(btnConfirm).toBeVisible({ timeout: 5000 });
    await btnConfirm.click();
    await page.waitForTimeout(5000);
    console.log('✅ Comando disparado e confirmado');

    // ── Verificar resultado via UI ─────────────────────────────────────────
    expect(uploadResponses.length).toBeGreaterThan(0);
    expect(uploadResponses[0].status).toBe(201);

    // Verifica mensagem de sucesso na UI
    await expect(page.getByText(/Atualiza.*o despachada/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Comando enviado para/i)).toBeVisible();
    console.log('\n📊 RESULTADO: UI confirma despacho bem-sucedido ✅');
  });
});
