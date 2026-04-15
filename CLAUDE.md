# E.Guardian MDM — Contexto do Projeto

## Visão Geral
Sistema MDM (Mobile Device Management) enterprise composto por:
- **Backend**: NestJS + TypeORM + PostgreSQL
- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Android Agent**: Kotlin + Device Owner API

O sistema permite gerenciar dispositivos Android remotamente: políticas, kiosk mode, admin lock, apps, geolocalização, etc.

---

## Estrutura do Projeto

```
/
├── backend/          # NestJS API
├── frontend/         # Next.js dashboard
├── android/          # Agente Android (E.Guardian)
├── database/         # Migrations SQL
└── scripts/          # Scripts de setup/build
```

---

## Como Rodar (Desenvolvimento)

### Backend
```bash
cd backend
npm install
# criar backend/.env (ver seção Variáveis de Ambiente)
npx nest build
node dist/main.js
# ou em watch: npx nest start --watch
```

### Frontend
```bash
cd frontend
npm install
# criar frontend/.env.local (ver seção Variáveis de Ambiente)
npm run dev
```

### Android (emulador)
```bash
# Build APK debug
cd android
./gradlew assembleDebug

# Instalar no emulador
adb install -r app/build/outputs/apk/debug/app-debug.apk

# Setar como Device Owner (obrigatório para kiosk/admin lock)
adb shell dpm set-device-owner com.mdm.enterprise.debug/com.mdm.enterprise.admin.MdmDeviceAdminReceiver

# Enrollment via dev mode (apenas emuladores locais)
adb shell am start -n "com.mdm.enterprise.debug/com.mdm.enterprise.ui.MainActivity" \
  -a DEV_ENROLL \
  --es dev_device_token "TOKEN_DO_DEVICE" \
  --es dev_api_url "http://10.0.2.2:3001"

# Enrollment via ADB — PRODUÇÃO/HOMOLOG (fluxo real, chama API enrollWithToken)
# 1. adb install -r app-homolog.apk
# 2. adb shell dpm set-device-owner com.mdm.enterprise.homolog/com.mdm.enterprise.admin.MdmDeviceAdminReceiver
# 3. Copiar comando gerado automaticamente em https://eg.expresso3300.com.br/enroll (seção "Enrollar via ADB")
#    O token é preenchido automaticamente — válido 1h, renovado junto com o QR
adb shell am start -n "com.mdm.enterprise.homolog/com.mdm.enterprise.ui.MainActivity" \
  -a "com.mdm.enterprise.ADB_ENROLL" \
  --es enrollment_token "TOKEN_DA_PAGINA_ENROLL" \
  --es server_url "https://eg.expresso3300.com.br/api/v1" \
  --es tenant_id "TENANT_UUID"
```

---

## Variáveis de Ambiente

### `backend/.env`
```env
DATABASE_URL=postgresql://usuario:senha@localhost:5432/mdm_db
JWT_SECRET=seu_secret_aqui
JWT_REFRESH_SECRET=seu_refresh_secret_aqui
CORS_ORIGINS=http://localhost:3000
PORT=3001
```

### `frontend/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### `android/local.properties`
```
sdk.dir=C\:\\Users\\SEU_USUARIO\\AppData\\Local\\Android\\Sdk
```

---

## Arquitetura Android

### Device Owner
O E.Guardian precisa ser Device Owner para:
- Lock Task Mode (Admin Lock / Kiosk)
- `setApplicationHidden()` (esconder apps)
- `clearApplicationUserData()` (limpar grade do launcher)

### Serviços Principais
- **`CommandPollingService`**: polling a cada 5s buscando comandos pendentes + watchdog 1s para Admin Lock
- **`MdmPolicyService`**: executa políticas (kiosk, admin lock, apps, wifi, etc.)
- **`AdminLockActivity`**: tela de bloqueio administrativo com Lock Task Mode

### Admin Lock — Segurança
- Usa `startLockTask()` — impede swipe-to-home
- `AdminLockActivity.isInForeground` (volatile): watchdog detecta escape
- Watchdog no `CommandPollingService`: posta notificação full-screen (setFullScreenIntent) se lock ativo mas não em foreground
- **Não tem botão de emergência** (foi removido — era bypass de segurança)
- `onResume()` sempre re-entra lock task para prevenir escape

### Kiosk Mode
- `setApplicationHidden()`: esconde apps do drawer
- `clearApplicationUserData()` no launcher: limpa grade da home screen (Android 9+)

---

## Backend — Módulos Principais

### Commands (`backend/src/modules/commands/`)
- `CommandsService.create()`: auto-popula payload do `UPDATE_POLICY` se vazio (busca policy do device)
- `acknowledgeCommand()`: atualiza estado do device após execução:
  - `ENABLE_KIOSK` → `device.isKioskMode = true`
  - `DISABLE_KIOSK` → `device.isKioskMode = false`

### Apps (`backend/src/modules/apps/`)
- `syncFromDevice()`: **NÃO usa upsert** — faz SELECT primeiro, só atualiza `name` se existir (preserva `isSystem`)
- Apps com `isSystem=true` NÃO aparecem no seletor de apps obrigatórios no frontend
- Apps instalados manualmente (ForlogWMS, Gestor WMS, WiFiman, GLPI Agent) devem ter `isSystem=false`

---

## Frontend — Componentes Principais

### Página do Device (`frontend/src/app/(dashboard)/devices/[id]/page.tsx`)
- **Admin Lock modal**: envia `ADMIN_LOCK` com `{message, contact, severity}` (sem `allowEmergencyOnly`)
- **Exec popup**: mostra progresso de Admin Lock / Unlock em tempo real (polling a cada 2s)
- **Kiosk section**: botão único abre modal com toggle (on/off), quando ON mostra configurações
- `execRef` cleanup está em `useEffect([], [])` separado — NÃO dentro do effect de commands

### Dashboard KPI (`frontend/src/app/(dashboard)/dashboard/KpiCards.tsx`)
- `DateFilterBar`: presets (Hoje, 7d, 30d, Mês atual) + custom range — filtra `filteredSessions` e `filteredCommands`
- `PeakConcurrentCard`: sweep-line para máximo de sessões simultâneas
- `PeakHourCard`: click na barra abre modal com usuários daquela hora + tempo total de sessão
- Cores das barras: `bg-primary-100` (não `bg-primary-200`, que não existe na config Tailwind)
- Layout segunda linha: `lg:grid-cols-5`

### Página de Políticas (`frontend/src/app/(dashboard)/policies/page.tsx`)
- **DispatchProgressModal**: genérico com props `title`, `subtitle`, `successLabel`; usado para UPDATE_POLICY e Admin Lock
- **Bulk Admin Lock ("Chamar para T.I.")**: ícone de cadeado no card da política → modal com templates/severity/mensagem/contato → envia `ADMIN_LOCK` a todos os devices
- **handleBulkUnlock**: envia `ADMIN_UNLOCK` aos devices em lock → mesmo popup de progresso
- **Banner de status**: âmbar "X/Y em Admin Lock" com botão "Desbloquear todos"; verde "Todos desbloqueados"
- **`isDeviceLocked(deviceId)`**: deriva estado de lock do histórico de comandos (último ADMIN_LOCK vs ADMIN_UNLOCK por `createdAt`)
- `commands` refreshado imediatamente após envio + a cada tick de polling (sem necessitar F5)

---

## Bugs Conhecidos e Corrigidos

| Bug | Causa | Fix |
|-----|-------|-----|
| Admin Lock bypass via swipe | `stopLockTask()` antes de abrir discador | Removido botão de emergência |
| Watchdog não conseguia reabrir activity | `startActivity()` bloqueado no Android 10+ em background | Trocado por `setFullScreenIntent` (notificação full-screen) |
| Exec popup ficava em loading infinito | `execRef` cleanup dentro de `useEffect([commands])` | Movido para `useEffect([], [])` separado |
| Ícones permaneciam na home após kiosk | `setApplicationHidden()` não limpa grid da home | Adicionado `clearApplicationUserData()` no launcher |
| `isKioskMode` não atualizava no banco | `acknowledgeCommand` não sincronizava estado | Adicionado update em `acknowledgeCommand` |
| Apps obrigatórios não apareciam no seletor | `syncFromDevice` sobrescrevia `isSystem=false` com `true` | Substituído upsert por find + insert condicional |
| UPDATE_POLICY chegava com payload vazio `{}` | Frontend enviava sem payload | Backend auto-popula de policy atribuída ao device |
| Double-poll bug (commands executados múltiplas vezes) | `onStartCommand` lançava novas coroutines sem cancelar as anteriores | `pollingJob?.cancel()` antes de `startPollingLoop()`; watchdog virou filho do job |
| Crash API 25 ao aplicar policy com USB bloqueado | `setUsbDataSignalingEnabled()` é API 31+ — lança `NoSuchMethodError` (não pego por `catch Exception`) | Guard `Build.VERSION.SDK_INT >= S` em `blockUSBDataTransfer()` |
| Listagem de device-users retornava 500 | `ValidationPipe` com `enableImplicitConversion` converte `@Query` ausente para `NaN`; `NaN ?? 1 = NaN` | Troca `??` por `\|\|` no `findAll` (page/limit defaults) |
| Mesmo usuário logado em 2 dispositivos simultaneamente | `closeActiveForDevice` fechava só sessão do device atual, não do user | `closeActiveForUser` fecha todas sessões do user; `validateSession` (GET 410) + re-login com toast no Android |
| Kiosk re-ativação escondia todos os apps | `queryIntentActivities(intent, 0)` não enxerga apps ocultos por `setApplicationHidden()` | Corrigido com `MATCH_UNINSTALLED_PACKAGES` em `MdmPolicyService.enableKioskMode` |
| `kioskApps` não persistia no banco | `acknowledgeCommand` só salvava `isKioskMode=true`, sem salvar a lista | Adicionado `kioskApps` no update do `ENABLE_KIOSK`; limpo no `DISABLE_KIOSK` |
| Checkboxes desmarcados ao reabrir modal kiosk | Frontend não pré-selecionava `device.kioskApps` ao exibir lista | `fetchApps` faz interseção com `device.kioskApps` ao receber lista do device |
| Versão do agente não visível | Nenhum campo rastreava a versão do APK instalado nos devices | Header `X-Agent-Version` enviado em todo poll; salvo em `devices.agentVersion`; exibido no frontend |
| Kiosk com app não instalado causava tela preta | `setApplicationHidden()` escondia todos os apps quando nenhum da whitelist estava instalado | Guard em `enableKioskMode`: `selected.isEmpty() && mode == "whitelist" → abort` |
| Loop infinito de lockNow no watchdog de sessão | Watchdog chamava `lockNow()` a cada 2s sem conseguir mostrar DeviceLoginActivity, causando tela preta permanente | Flag `lockFired`: lockNow só na primeira vez; chamadas seguintes só atualizam notificação |
| DeviceLoginActivity não aparecia no Android 14 após lockNow | `USE_FULL_SCREEN_INTENT` restrito no Android 14 — full-screen notification não lançava a activity | Substituído por wake lock + `setKeyguardDisabled(true)` + `startActivity()` + re-enable após 3s (Device Owner) |
| Kiosk pendente não se auto-aplicava após instalação de app | `enableKioskMode` abortava silenciosamente; app nunca era instalado pois `requiredApps` estava vazio | Kiosk salvo como pendente em SharedPrefs; `applyPendingKioskIfReady()` chamado a cada poll (5s) aplica quando app instalado |
| Admin lock watchdog não funcionava no Android 14+ (API 36) | `setFullScreenIntent` bloqueado no Android 14 sem permissão `USE_FULL_SCREEN_INTENT` | Device Owner path: wake lock + `setKeyguardDisabled(true)` + `startActivity()` + re-enable após 3s em `postAdminLockAlert` |
| Crash do app liberava admin lock | `onStartCommand` não verificava estado de lock ao reiniciar após crash | `onStartCommand` chama `postAdminLockAlert(forceStart=true)` imediatamente se lock ativo mas não em foreground |
| Crash API 25 em `getNotificationChannel()` | Método é API 26+ (`Build.VERSION_CODES.O`); chamado sem guard de versão | Guard `Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&` antes de `nm.getNotificationChannel()` em `postLoginRequiredAlert` e `postAdminLockAlert` |
| Device-sessions endpoint retornava 500 com `?limit=500` | `ValidationPipe enableImplicitConversion` converte `@Query` ausente para `NaN`; `NaN ?? 1 = NaN` | Troca `??` por `\|\|` em `device-sessions.service.ts` (mesma fix aplicada antes em device-users) |
| Barras do gráfico "Pico de uso por hora" invisíveis | Cor `bg-primary-200` não definida na config Tailwind JIT | Corrigido para `bg-primary-100` em `KpiCards.tsx` |
| Upload de APK retornava HTTP 413 no homolog | nginx sem `client_max_body_size` — padrão 1MB bloqueava APK de ~26MB | Adicionado `client_max_body_size 50m` em `/etc/nginx/sites-available/eguardian` no EC2 |
| Status de lock não atualizava sem F5 na página de políticas | `commands` state só era refreshado ao `allDone` | `commandsApi.list` chamado imediatamente após envio + `setCommands(cmds)` em cada tick de polling |
| Device transferido para política lockada não recebia o lock | Fix inicial estava em `DevicesService.update()` mas o frontend usa `policiesApi.assign` e `deviceGroupsApi.addDevice` — endpoints diferentes | `syncAdminLockForNewDevice()` em `PoliciesService.assignToDevice()` e `DeviceGroupsService.addDevice()`: bidirecional — nova política lockada → `ADMIN_LOCK`; nova política unlocked mas device lockado → `ADMIN_UNLOCK` |
| Device transferido de política lock para unlock permanecia lockado | `syncAdminLockForNewDevice()` só tratava o sentido lock→lock | Mesmo método agora verifica se o device em si está lockado (`deviceLastLock > deviceLastUnlock`) e envia `ADMIN_UNLOCK` se a nova política não está lockada |
| GPS não aparecia no mapa após ativar rastreamento na política | `LocationTrackingWorker` falhava antes de chamar a API por checar `jwt_token` (nunca salvo no device); `applyPolicy()` nunca iniciava o worker ao aplicar a política | Removido `jwt_token` do worker (endpoint é `@Public()`); adicionado bloco location tracking em `applyPolicy()` que agenda o worker + dispara fix imediato |
| `UPDATE_POLICY` não chegava em API34/36 sem abrir o app | `foregroundServiceType="dataSync"` tem quota de 6h/dia no Android 14+ — OS matava o `CommandPollingService` silenciosamente após a quota | Trocado para `specialUse` (sem quota); `CommandPollingService.start()` adicionado ao `MdmApplication.onCreate()`; `CommandPollingWorker` virou watchdog que reinicia o serviço a cada 15 min |
| Comandos não executavam com tela apagada | Certas device-admin APIs requerem CPU ativo; service podia ser suspenso | `PARTIAL_WAKE_LOCK` adquirido no `pollCommands()` antes de executar — mantém CPU sem acender tela |
| `ADMIN_LOCK` não aparecia com tela apagada | `PARTIAL_WAKE_LOCK` não acende a tela | Case `ADMIN_LOCK` adquire `FULL_WAKE_LOCK + ACQUIRE_CAUSES_WAKEUP` especificamente antes de chamar `adminLock()` |
| Após `ADMIN_UNLOCK` o keyguard aparecia e exigia interação | `finish()` da `AdminLockActivity` devolvia foco ao keyguard do Android | `unlockReceiver.onReceive` chama `requestDismissKeyguard()` (API 26+) ou `ACTION_HOME` (API 25) antes de `finish()` |
| Comandos não chegavam após reboot sem unlock | `BOOT_COMPLETED` só dispara após primeiro unlock; service não iniciava antes | Direct Boot: `BootPrefs` (device-protected storage) espelha credenciais no enrollment; `LOCKED_BOOT_COMPLETED` inicia o service antes do unlock; `CommandPollingService` + `MdmApiClient` fazem fallback para `BootPrefs` quando `SecurePreferences` indisponível |
| Velocidade de download não medida no teste de rede | `NetworkTestExecutor` só coletava dados Wi-Fi (SSID, RSSI, redes próximas) | Adicionado `measureDownloadSpeedMbps()`: busca token do fast.com no JS, chama API, faz download por 8s e calcula Mbps; frontend exibe card verde "X.X Mbps / Medido via fast.com" |
| Timeout de inatividade não disparava com tela ligada | `UserActivityMonitorService` chamava `recordActivity()` a cada 15s quando `pm.isInteractive == true`, anulando a detecção real de toque | Removido bloco `if (pm.isInteractive) { recordActivity() }` — timer só reseta via `dispatchTouchEvent` (lock task) e `MdmAccessibilityService` (sessão ativa) |

---

## Frontend — Tela Minha Conta (`/conta`)
- Perfil: avatar com inicial, nome completo, email, role badge (read-only)
- Alterar Senha: form com `currentPassword`, `newPassword`, `confirmPassword`; validação de match + min 8 chars
- API: `PATCH /tenants/:id/users/:id/change-password` com `{ currentPassword, newPassword }`
- Erro mapeado: `"Current password is incorrect"` → "Senha atual incorreta."
- Link "Minha Conta" na sidebar (seção inferior, com estado ativo)

## Android — Direct Boot (`BootPrefs`)
- `BootPrefs.kt`: device-protected SharedPreferences com `device_token`, `device_id`, `tenant_id`, `server_url`
- Populado no enrollment (todos os 3 fluxos: QR, ADB, dev)
- Lido em `LOCKED_BOOT_COMPLETED`, `CommandPollingService.pollCommands()` e `MdmApiClient.buildClient()`
- Devices já enrollados precisam de re-enrollment OU receber UPDATE_AGENT para popular o `BootPrefs`

---

## Estado Atual do Banco de Dados (Emulador)

- Tenant: E.Guardian (`2c55c328-daa0-4342-9ec9-b36864264878`)
- 4 devices ativos (ver memory/project_emulators.md para IDs e tokens atuais)
- Device-user: `teste` / pin `1234` (ACTIVE)
- Apps com `isSystem=false` (aparecem no seletor): ForlogWMS, Gestor WMS, WiFiman, GLPI Agent, ES File Explorer
- Policy padrão: com regras e apps obrigatórios configurados
- Git: inicializado em `C:\claude\e.guardian-master`, commit `06f4c9a`

---

## Convenções

- Branch principal: `master`
- Commits em inglês, co-authored com Claude
- `.env` nunca vai para o git
- APKs e uploads nunca vão para o git (`backend/uploads/` ignorado)
- Arquivo `CLAUDE.md` é o contexto compartilhado entre sessões e PCs
