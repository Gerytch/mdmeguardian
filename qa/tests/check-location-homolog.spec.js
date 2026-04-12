const { test, expect, request } = require('@playwright/test');

const BASE_URL = 'https://eg.expresso3300.com.br';

test.describe('Location Tracking Diagnostics — Homolog', () => {
  let apiContext;
  let token;
  let tenantId;
  let deviceId;

  test.beforeAll(async () => {
    apiContext = await request.newContext({ baseURL: BASE_URL });

    // 1. Login
    const login = await apiContext.post('/api/v1/auth/login', {
      data: { email: 'admin@eguardian.com', password: 'Admin@123' },
    });
    expect(login.ok(), `Login failed: ${login.status()}`).toBeTruthy();
    const loginBody = await login.json();
    token = loginBody.accessToken;
    tenantId = loginBody.user?.tenantId || loginBody.tenantId;
    console.log('Login body keys:', Object.keys(loginBody));
    console.log('✅ Login OK | tenantId:', tenantId);
  });

  test('1 — listar devices e pegar deviceId ativo', async () => {
    const res = await apiContext.get(`/api/v1/tenants/${tenantId}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const devices = await res.json();
    console.log('Devices:', JSON.stringify(devices.map(d => ({
      id: d.id, name: d.name, isOnline: d.isOnline, status: d.status
    })), null, 2));

    const active = devices.find(d => d.isOnline) || devices[0];
    expect(active, 'Nenhum device encontrado').toBeTruthy();
    deviceId = active.id;
    console.log('✅ Device selecionado:', deviceId, '| online:', active.isOnline);
  });

  test('2 — checar geolocalizações existentes', async () => {
    const res = await apiContext.get(
      `/api/v1/tenants/${tenantId}/geolocation?deviceId=${deviceId}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log('Geolocation status:', res.status());
    const body = await res.json();
    console.log('Geolocations:', JSON.stringify(body, null, 2));
  });

  test('3 — enviar LOCATE e aguardar 30s', async () => {
    const res = await apiContext.post(`/api/v1/tenants/${tenantId}/commands`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { deviceId, type: 'LOCATE' },
    });
    console.log('LOCATE command status:', res.status());
    const body = await res.json();
    console.log('Command created:', JSON.stringify(body));

    console.log('⏳ Aguardando 30s para o device responder...');
    await new Promise(r => setTimeout(r, 30000));

    const after = await apiContext.get(
      `/api/v1/tenants/${tenantId}/geolocation?deviceId=${deviceId}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const afterBody = await after.json();
    console.log('Geolocations após LOCATE:', JSON.stringify(afterBody, null, 2));
  });

  test('4 — POST direto de localização fake para testar endpoint', async () => {
    const res = await apiContext.post(`/api/v1/tenants/${tenantId}/geolocation`, {
      data: {
        deviceId,
        latitude: -23.5505,
        longitude: -46.6333,
        accuracy: 10.0,
        timestamp: new Date().toISOString(),
      },
    });
    console.log('POST geolocation status:', res.status());
    const body = await res.json().catch(() => ({}));
    console.log('Response:', JSON.stringify(body));

    expect(res.status(), 'Endpoint não aceitou localização fake').toBeLessThan(400);
  });

  test('5 — verificar se localização fake apareceu', async () => {
    await new Promise(r => setTimeout(r, 2000));
    const res = await apiContext.get(
      `/api/v1/tenants/${tenantId}/geolocation?deviceId=${deviceId}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const body = await res.json();
    console.log('Geolocations final:', JSON.stringify(body, null, 2));

    // Verifica se tem pelo menos uma entrada
    const list = Array.isArray(body) ? body : (body.data || []);
    console.log(`Total de localizações: ${list.length}`);
    expect(list.length, 'Nenhuma localização salva no banco').toBeGreaterThan(0);
  });

  test('6 — frontend: mapa mostra o pin', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('[name="email"]', 'admin@eguardian.com');
    await page.fill('[name="password"]', 'Admin@123');
    await page.click('[type="submit"]');
    await page.waitForURL('**/dashboard**', { timeout: 15000 });

    // Navega para o device e abre o mapa
    await page.goto(`${BASE_URL}/devices/${deviceId}`);
    await page.waitForLoadState('networkidle');

    // Screenshot para ver o estado do mapa
    await page.screenshot({ path: 'results/map-check.png', fullPage: false });
    console.log('Screenshot salvo em results/map-check.png');

    // Verifica se há algo relacionado ao mapa na página
    const mapVisible = await page.locator('[class*="map"], #map, .leaflet-container').isVisible().catch(() => false);
    console.log('Mapa visível:', mapVisible);
  });
});
