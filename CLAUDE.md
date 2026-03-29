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

# Enrollment via dev mode
adb shell am start -n "com.mdm.enterprise.debug/com.mdm.enterprise.ui.MainActivity" \
  -a DEV_ENROLL \
  --es dev_device_token "TOKEN_DO_DEVICE" \
  --es dev_api_url "http://10.0.2.2:3001"
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
