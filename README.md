# MDM SaaS — Mobile Device Management Platform

Sistema SaaS de MDM (Mobile Device Management) corporativo para Android.
Arquitetura multi-tenant, construído por múltiplos agentes especializados.

---

## Agentes de Engenharia

| Agente | Responsabilidade | Entregável |
|--------|-----------------|------------|
| **Arquiteto** | Arquitetura SaaS multi-tenant, DDD, Clean Architecture | `docs/ARCHITECTURE.md` |
| **Backend Engineer** | NestJS REST API, PostgreSQL, JWT, TypeORM | `backend/` |
| **Android Engineer** | Kotlin, Device Owner, Kiosk, QR Provisioning | `android/` |
| **Frontend Engineer** | Next.js dashboard, React Query, Leaflet maps | `frontend/` |
| **QA Engineer** | Plano de testes unitários, integração, e2e | `docs/QA_PLAN.md` |
| **Security Engineer** | JWT, criptografia, OWASP mitigations | `docs/SECURITY.md` |
| **DevOps Engineer** | Setup local sem Docker, scripts, PM2 | `docs/DEVOPS_SETUP.md` |

---

## Stack Tecnológica

```
Backend:   Node.js 20 + NestJS 10 + TypeORM + PostgreSQL 15
Frontend:  Next.js 14 (App Router) + Tailwind CSS + React Query
Android:   Kotlin + Device Owner API + WorkManager + Retrofit
Auth:      JWT (access 15m + refresh 7d + device token 30d)
```

---

## Funcionalidades

- **Autenticação** — Login obrigatório no dispositivo, sessão controlada pelo backend
- **Controle de Apps** — Whitelist/blacklist, Modo Kiosk (single/multi-app), instalação remota
- **Geolocalização** — Coleta periódica, histórico, geofencing com alertas
- **Provisionamento** — QR Code → Android Enterprise → registro automático
- **Comandos Remotos** — LOCK, WIPE, REBOOT, INSTALL_APP, UPDATE_POLICY, LOCATE
- **Painel Web** — Dashboard em tempo real, mapa de dispositivos, gestão de políticas

---

## Estrutura do Projeto

```
mdm-code/
├── backend/                    # NestJS API (porta 3000)
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── common/             # Guards, filtros, decorators
│   │   └── modules/
│   │       ├── auth/           # JWT, login, registro
│   │       ├── tenants/        # Multi-tenant
│   │       ├── users/          # Gestão de usuários
│   │       ├── devices/        # Dispositivos Android
│   │       ├── apps/           # Catálogo de apps
│   │       ├── policies/       # Políticas MDM
│   │       ├── geolocation/    # Rastreamento GPS
│   │       └── commands/       # Comandos remotos
│   └── package.json
├── frontend/                   # Next.js Dashboard (porta 3001)
├── android/                    # App Kotlin (Device Owner)
│   └── app/src/main/kotlin/com/mdm/enterprise/
│       ├── admin/              # DeviceAdminReceiver
│       ├── services/           # PolicyService, LocationWorker, CommandPolling
│       ├── api/                # Retrofit client + models
│       └── provisioning/       # QR enrollment
├── database/
│   ├── migrations/             # SQL schema
│   └── seed.sql                # Dados de desenvolvimento
├── docs/                       # Documentação dos agentes
└── scripts/                    # Setup e inicialização
```

---

## Quick Start

### Windows
```bat
cd scripts
setup-windows.bat
```

### Linux / macOS
```bash
cd scripts
chmod +x setup-linux.sh && ./setup-linux.sh
```

### Manual

**1. PostgreSQL**
```sql
CREATE USER mdm_user WITH PASSWORD 'mdm_password';
CREATE DATABASE mdm_saas OWNER mdm_user;
\c mdm_saas
\i database/migrations/001_initial_schema.sql
\i database/seed.sql
```

**2. Backend**
```bash
cd backend
cp .env.example .env   # edite as variáveis
npm install
npm run start:dev      # http://localhost:3000/api/v1/docs
```

**3. Frontend**
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3001
```

---

## Credenciais de Desenvolvimento

| Campo | Valor |
|-------|-------|
| URL | http://localhost:3001 |
| Tenant | `acme-corp` (header: `X-Tenant-ID: acme-corp`) |
| Email | `admin@acme-corp.com` |
| Senha | `Admin@12345` |
| API Docs | http://localhost:3000/api/v1/docs |

---

## Device Owner (Android)

Para setar o app como Device Owner durante desenvolvimento:
```bash
adb shell dpm set-device-owner com.mdm.enterprise/.admin.MdmDeviceAdminReceiver
```

> O dispositivo deve estar sem conta Google ativa para aceitar Device Owner via ADB.

---

## Endpoints Principais

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/v1/auth/login` | Login (requer `X-Tenant-ID`) |
| POST | `/api/v1/auth/register` | Registrar tenant + admin |
| GET | `/api/v1/auth/me` | Perfil do usuário logado |
| GET | `/api/v1/tenants/:id/devices` | Listar dispositivos |
| POST | `/api/v1/tenants/:id/devices` | Registrar dispositivo |
| PATCH | `/api/v1/tenants/:id/devices/:id/status` | Atualizar status |
| POST | `/api/v1/tenants/:id/commands` | Enviar comando |
| GET | `/api/v1/device/commands/pending` | Poll de comandos (device token) |
| PATCH | `/api/v1/device/commands/:id/ack` | ACK de comando |
| GET | `/api/v1/tenants/:id/geolocation/latest` | Mapa (última localização) |

---

## Decisões Arquiteturais (Discussão dos Agentes)

### Multi-tenancy
**Arquiteto vs Backend:** Optamos por `tenant_id` em todas as tabelas (abordagem shared schema) ao invés de schemas separados por tenant. Razão: simplicidade operacional sem perda de isolamento — todos os services recebem `tenantId` como primeiro parâmetro e sempre filtram por ele.

### Polling vs WebSocket (Comandos)
**Android vs Backend:** O WorkManager tem mínimo de 15 minutos para tarefas periódicas. Para comandos urgentes (LOCK, WIPE), implementar um **foreground service** com loop de coroutine e `delay(30_000)` é a solução correta. O blueprint atual usa WorkManager como ponto de partida seguro.

### Autenticação de Dispositivo
**Security vs Android:** Device tokens são longos (96 bytes hex), armazenados no `EncryptedSharedPreferences` com AES256-GCM, nunca retornados em listagens (campo `select: false` no TypeORM). Tokens de dispositivo usam secret JWT separado do token de usuário.

### Riscos Técnicos Conhecidos
1. **Android 15+** — `setUsbDataSignalingEnabled` pode requerer permissões adicionais
2. **WorkManager mínimo** — 15 min real; foreground service necessário para polling mais rápido
3. **Root detection** — Não implementado no blueprint; adicionar SafetyNet/Play Integrity API
4. **Certificate pinning** — Não implementado; crítico para produção (adicionar no OkHttp)
