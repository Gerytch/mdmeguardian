# E.Guardian MDM — Changelog

All notable changes to this project are documented here.

---

## [0.9.1] — 2026-04-12 — APK 1.5.0 (sem mudança Android)

### Summary
Sessão de validação e QA do ambiente de homologação. Confirmado que GPS e atualização remota de agente (UPDATE_AGENT) funcionam de ponta a ponta no dispositivo físico (Samsung SM-A156M). Esta etapa foi crucial para liberar o sistema para mais dispositivos em produção.

### Added
- **[qa/tests/update-agent-e2e.spec.js]**: teste Playwright E2E completo do fluxo UPDATE_AGENT — login → upload APK → preencher versão → confirmar despacho → validar UI "Atualização despachada" → validar instalação silenciosa via logcat ADB
- **[qa/tests/debug-upload-apk.spec.js]**: teste de diagnóstico de upload de APK (debug, pode ser removido)

### Fixed
- **[EC2 nginx /etc/nginx/sites-available/eguardian]**: adicionado `client_max_body_size 50m` — nginx bloqueava uploads de APK com HTTP 413 (APK do agente tem ~26MB)

### Validated (sem mudança de código)
- Upload de APK via frontend funciona em homolog (https://eg.expresso3300.com.br)
- UPDATE_AGENT: device Samsung SM-A156M recebe comando, baixa 26MB, instala silenciosamente e reinicia o agente
- GPS / localização: rastreamento funciona end-to-end em dispositivo físico
- Campo `version` no payload UPDATE_AGENT chega corretamente no device (ex: `v9.9.9-test`)

### Decisions
- Testes QA de UPDATE_AGENT usam o APK homolog real (não dummy) para garantir instalação válida no device
- Asserção do resultado via UI ("Atualização despachada!") em vez de interceptar HTTP — endpoint de despacho pode variar

---

## [0.9.0] — 2026-04-11 — APK 1.5.0 (versionCode 29)

### Summary
Três novos features: deduplicação de pins no mapa de localização, endpoint DELETE para registros de geolocalização, e reporte assíncrono do resultado de instalação do UPDATE_AGENT. Adicionado popup de confirmação ao atualizar todos os dispositivos de uma vez.

### Added
- **[backend/geolocation.controller.ts]**: endpoint `DELETE /tenants/:tenantId/geolocation/:locationId` para remover registros de localização via API
- **[backend/commands.service.ts + controller]**: endpoint `PATCH /device/commands/:id/install-result` — agent reporta resultado do install pós-restart sem alterar status do comando
- **[android/CommandPollingService.kt]**: salva `{commandId, targetVersion, timestamp}` em SharedPrefs antes do install; `checkPendingAgentUpdate()` no restart compara versionName atual com target e reporta sucesso ou falha
- **[android/ApiModels.kt + MdmApiClient.kt]**: `InstallResultRequest` + `reportInstallResult()` na interface Retrofit
- **[frontend/devices/page.tsx]**: popup de confirmação âmbar ao despachar UPDATE_AGENT para todos os dispositivos (alerta de ambiente homologação/produção)
- **[frontend/devices/[id]/page.tsx]**: badge de resultado na lista de comandos UPDATE_AGENT: "Instalando..." / "✓ Instalado vX.Y.Z" / "✗ Falha"

### Fixed
- **[backend/geolocation.service.ts]**: substituído `MAX+JOIN` por `DISTINCT ON (deviceId) ORDER BY timestamp DESC` — eliminava pins duplicados quando dois registros tinham o mesmo timestamp
- **[frontend/dashboard/page.tsx]**: deduplicação por deviceId no frontend como camada de segurança extra

### Decisions
- Resultado do UPDATE_AGENT é reportado via endpoint separado (não no ACK) pois o app é morto durante a auto-atualização; SharedPrefs persiste o commandId entre processos
- Timeout de 5 minutos: se após 5 min a versão ainda não bate, reporta falha automaticamente

---

## [0.8.0] — 2026-04-11 — APK 1.4.2 (versionCode 28)

### Summary
Fix completo do rastreamento de GPS em dispositivos físicos Samsung. Reescrita do LocationTrackingWorker para usar coroutines nativas em vez de Tasks.await(). Estratégia de 4 camadas para obter localização. Auto-ativação de GPS via Device Owner. Tutorial de configuração no app Android e na página de enrollment do frontend.

### Fixed
- **[android/LocationTrackingWorker]**: `Tasks.await()` causava `TimeoutException` em contexto de coroutine — substituído por `suspendCancellableCoroutine` + `addOnSuccessListener`
- **[android/LocationTrackingWorker]**: `getCurrentLocation()` retornava null em cold start/indoor — adicionado `requestLocationUpdates` (ativo, acorda o hardware GPS) como fallback
- **[android/MdmPolicyService]**: `LOCATION_MODE` deprecated no Android 9+ — substituído por `dpm.setLocationEnabled(adminComponent, true)` (API 28+)

### Added
- **[android/LocationTrackingWorker]**: Estratégia de 4 camadas: `lastLocation` → BALANCED ativo → HIGH_ACCURACY ativo → `LocationManager` nativo (bypass GMS)
- **[android/MdmPolicyService]**: `setLocationEnabled()` auto-ativado via Device Owner quando `locationTracking = true`
- **[android/MainActivity]**: Dialog de configuração GPS exibido uma vez após enrollment — guia o T.I. para ativar "Precisão de localização" e "Procura de Wi-Fi" em Serviços de localização
- **[frontend/enroll]**: Card âmbar com tutorial de 3 passos para configuração GPS na página `/enroll`
- **[frontend/devices]**: Botão "Adicionar Dispositivo" agora redireciona para `/enroll` — modal de QR removido (enrollment centralizado em `/enroll`)

---

## [0.7.0] — 2026-04-10 — APK 1.3.3 (versionCode 19)

### Summary
Fix de GPS em dispositivos físicos (homologação): permissão de localização agora é auto-concedida via Device Owner. Nova feature de atualização em massa do agente via backend.

### Fixed
- **[android/MdmPolicyService]**: GPS não funcionava em dispositivos físicos porque `ACCESS_FINE_LOCATION` não era auto-concedida. Adicionado `dpm.setPermissionGrantState(GRANTED)` para `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` e `ACCESS_BACKGROUND_LOCATION` quando Device Owner e `locationTracking = true`

### Added
- **[backend/commands.service]**: Novo método `dispatchAgentUpdate` — envia `UPDATE_AGENT` em massa para todos os devices do tenant ou lista selecionada
- **[backend/commands.controller]**: Novo endpoint `POST /tenants/:tenantId/agents/dispatch-update` com body `{ apkUrl, version, deviceIds? }`

---

## [0.6.1] — 2026-04-05 — APK 1.3.1 (versionCode 17)

### Summary
Fix do rastreamento de GPS: localização não aparecia no mapa porque o worker falhava silenciosamente antes de fazer a chamada, e a policy nunca iniciava o worker ao ser aplicada.

### Fixed
- **`MdmApiClient.kt`**: removido `@Header("Authorization")` de `postLocation` — endpoint é `@Public()` no backend; o parâmetro `jwt_token` (nunca armazenado no device) causava `Result.failure()` imediato antes de qualquer requisição HTTP
- **`LocationTrackingWorker.kt`**: removida dependência de `jwt_token`; `schedule()` trocou `KEEP` por `REPLACE` para que mudança de intervalo na política tenha efeito imediato; adicionado `cancel()` no companion object
- **`MdmPolicyService.applyPolicy()`**: adicionado bloco de location tracking — `locationTracking=true` agenda o worker com o intervalo da política e dispara um fix imediato; `locationTracking=false` cancela o worker

---

## [0.6.0] — 2026-04-05 — APK 1.3.0 (versionCode 16)

### Summary
Atribuição de políticas a grupos de dispositivos direto na página de políticas; refatoração da página de grupos para focar em criação e gerenciamento de membros; fix de foreground service no Android 14+ que impedia recebimento de comandos em background; script de reset do banco de dados.

### Added
- **`frontend/policies/page.tsx`**: seção "Grupos" em cada card de política — dropdown para atribuir/remover grupos; lista grupos atualmente vinculados com contagem de dispositivos
- **`database/reset.js`**: script Node.js para wipe completo do banco preservando tenant e admin (`node database/reset.js`)

### Changed
- **`frontend/groups/page.tsx`**: removidos controles de atribuição/remoção de política (botões, modal e handlers) — página agora é exclusiva para criar grupos e gerenciar membros. Badge de política permanece como informação somente-leitura
- **`android/AndroidManifest.xml`**: `CommandPollingService` e `UserActivityMonitorService` trocaram `foregroundServiceType="dataSync"` → `specialUse`; adicionada permissão `FOREGROUND_SERVICE_SPECIAL_USE` e meta-data com justificativa

### Fixed
- **Android 14+ background service killed**: `dataSync` tem quota de 6h/dia no Android 14+ — após a quota o OS matava o `CommandPollingService` silenciosamente, impedindo recebimento de `UPDATE_POLICY` sem abrir o app. Corrigido com `specialUse` (sem quota)
- **`MdmApplication.kt`**: adicionado `CommandPollingService.start()` no `onCreate()` — garante que o serviço sobe em todo restart de processo (boot, update, pressão de memória), não só no boot via `BOOT_COMPLETED`
- **`CommandPollingWorker.kt`**: worker agora atua como watchdog — reinicia `CommandPollingService` a cada execução (15 min), recuperando eventuais mortes pelo OS entre os ciclos

### Decisions
- `specialUse` é o tipo correto para agentes MDM persistentes; `dataSync` é para sincronizações pontuais. A mudança é semanticamente correta e remove a restrição de quota
- Política é atribuída ao grupo a partir da tela de políticas (fluxo natural: "quero que esta política cubra estes grupos"), não da tela de grupos
- `CommandPollingWorker` com `KEEP` mantém o schedule existente sem resetar o timer — comportamento correto para watchdog

---

## [0.5.2] — 2026-04-05

### Summary
Fix bidirecional de sincronização de admin lock ao transferir devices entre políticas.

### Fixed
- **[backend/policies.service.ts]**: `syncAdminLockForNewDevice()` agora também envia `ADMIN_UNLOCK` se o device estava lockado e a nova política não está lockada
- **[backend/device-groups.service.ts]**: mesma lógica bidirecional — lock→unlock e unlock→lock tratados corretamente
- **[backend]**: fix anterior (`syncAdminLockOnPolicyChange` em `DevicesService`) estava no lugar errado — o frontend usa `policiesApi.assign` e `deviceGroupsApi.addDevice`, não o `PATCH /devices/:id`

---

## [0.5.1] — 2026-04-05

### Summary
Fix de segurança: device transferido para uma política em admin lock agora recebe o ADMIN_LOCK automaticamente.

### Fixed
- **[backend/devices.service.ts]**: `DevicesService.update()` agora chama `syncAdminLockOnPolicyChange()` quando `policyId` muda — compara `createdAt` do último `ADMIN_LOCK` vs `ADMIN_UNLOCK` dos peers da política destino; se política está lockada, cria `ADMIN_LOCK PENDING` com o mesmo payload (mensagem/contato/severity)

---

## [0.5.0] — 2026-04-05 | APK 1.1.9 (versionCode 14)

### Summary
Dashboard KPI completo com 8 métricas operacionais, filtro de datas e gráfico de pico por hora com modal de detalhamento. Políticas ganham Admin Lock em massa com progress popup e indicador de status live. Três bugs críticos de crash corrigidos no Android (API 25, API 34+).

### Added
- **`frontend/dashboard/KpiCards.tsx`** (novo): 9 cards KPI — Heartbeat (threshold configurável), Sem política, Versão do agente, Kiosk, Taxa de sucesso de comandos, Tempo médio de resposta, Pico de uso por hora, Devices mais usados, Sessões simultâneas (sweep-line)
- **`frontend/dashboard/KpiCards.tsx`**: Filtro de datas nos KPIs (7 dias, 30 dias, este mês, mês passado, personalizado) — afeta todos os cards de sessões/comandos
- **`frontend/dashboard/KpiCards.tsx`**: Clique na barra do gráfico de pico abre modal com usuários e tempo total por hora
- **`frontend/policies/page.tsx`**: Botão "Chamar para T.I." no card de política — Admin Lock em massa com templates, severidade, contato e progress popup (polling 2s)
- **`frontend/policies/page.tsx`**: Botão "Desbloquear todos" aparece no banner âmbar quando devices estão em lock
- **`frontend/policies/page.tsx`**: Indicador de status de lock/unlock por política (banner âmbar com nomes dos devices, ou "Todos desbloqueados" verde)
- **`frontend/policies/page.tsx`**: Progress popup ao salvar política — envia `UPDATE_POLICY` a todos os devices atribuídos com tracking em tempo real
- **`frontend/policies/page.tsx`**: `commands` state atualizado em tempo real durante polling — banner de lock/unlock sem necessidade de F5

### Fixed
- **`backend/device-sessions.service.ts`**: 500 ao listar sessões com `limit=500` — `??` não trata `NaN`; substituído por `||` (mesmo fix já aplicado em `device-users`)
- **`android/CommandPollingService.kt`**: Crash no API 25 — `getNotificationChannel()` é API 26+ chamado sem guard `Build.VERSION.SDK_INT >= O` em `postLoginRequiredAlert` e `postAdminLockAlert`
- **`android/CommandPollingService.kt`**: Admin lock watchdog não relançava `AdminLockActivity` no Android 14+ — `setFullScreenIntent` bloqueado; substituído por wake lock + `setKeyguardDisabled(true)` + `startActivity()` (Device Owner path, igual ao session watchdog)
- **`android/CommandPollingService.kt`**: Crash recovery de admin lock — `onStartCommand` agora restaura admin lock imediatamente ao reiniciar após crash, sem esperar o watchdog (até 1s de exposição eliminado)
- **`android/CommandPollingService.kt`**: Watchdog de admin lock chamava `postAdminLockAlert` a cada 1s — adicionado flag `lockFired` para evitar hammering
- **`frontend/dashboard/KpiCards.tsx`**: Barras do gráfico de pico invisíveis — `bg-primary-200` não definido no Tailwind config (só 50/100/500/600/700/900); substituído por `bg-primary-100`
- **`frontend/dashboard/KpiCards.tsx`**: Tooltip com plural incorreto — `sessão` + `ões` gerava `sessãoões`; corrigido para ternário completo
- **DB seed**: Dados fake de `ADMIN_LOCK` sem `ADMIN_UNLOCK` correspondente deixavam API25 como "bloqueado" no frontend; inserido `ADMIN_UNLOCK` para corrigir

### Decisions
- `DispatchProgressModal` generalizado com props `title`, `subtitle`, `successLabel` — reutilizável para UPDATE_POLICY, ADMIN_LOCK e ADMIN_UNLOCK
- Status de lock/unlock derivado de histórico de comandos (mesmo padrão da página de device) — sem campo extra no banco
- Seed de dados fake dividido em 3 blocos DO separados para evitar rollback em cascata

---

## [0.4.0] — 2026-04-04

### Summary
Duas novas features de UX: (1) aviso de conflito ao mover device entre grupos com comparativo visual; (2) mapa com clustering inteligente (geo + pixel), reverse geocoding via Nominatim e popup agrupado por endereço.

### Added
- **`frontend/groups/page.tsx`**: modal de confirmação ao adicionar device que já pertence a outro grupo — dropdown mostra grupo atual, banner âmbar de aviso inline, modal comparativo lado a lado (grupo antigo vermelho vs novo verde) com nome, descrição, política e contagem de devices; alerta azul se a política vai mudar
- **`frontend/dashboard/DeviceMap.tsx`**: clustering híbrido — agrupa se distância geográfica ≤ 60m **ou** distância em pixel < 40px (zoom afastado agrupa tudo que sobrepõe visualmente)
- **`frontend/dashboard/DeviceMap.tsx`**: reverse geocoding via Nominatim (OpenStreetMap, gratuito, sem API key) — exibe endereço da rua no popup em vez de coordenadas; cache por posição + rate limit 250ms
- **`frontend/dashboard/DeviceMap.tsx`**: popup de cluster agrupa devices por endereço — quando há 2+ endereços distintos no cluster, exibe uma seção separada por localização

### Fixed
- **`frontend/dashboard/DeviceMap.tsx`**: pins não apareciam no carregamento inicial da página — `renderClusters` só era chamado no evento `moveend` que não disparava sempre; corrigido com `setTimeout(100ms)` direto após inicialização do mapa

### Changed
- **`frontend/dashboard/DeviceMap.tsx`**: threshold de clustering alterado de pixel fixo para métrico (60m geográfico + 40px visual)
- **`memory/project_emulators.md`**: IDs dos 4 devices corrigidos — haviam mudado após factory wipe de 2026-04-03 e estavam desatualizados na memória

### Decisions
- Clustering manual sem plugin externo (`leaflet.markercluster` foi testado mas incompatível com Next.js App Router — CSS de node_modules + SSR quebrava o mapa)
- Threshold híbrido (geo + pixel) resolve dois casos: filial com 10 devices a poucos metros (geo), e zoom afastado com devices distantes sobrepostos na tela (pixel)
- Nominatim escolhido por ser gratuito e não exigir API key; cache evita requests duplicados para mesma posição

---

## [0.3.4] — 2026-04-04

### Summary
Adicionado botão "Encerrar" na página de Sessões para derrubar sessões ativas remotamente pelo admin. O Android detecta a sessão encerrada no próximo poll (≤5s) e força re-login automaticamente.

### Added
- **`backend/device-sessions/device-sessions.controller.ts`**: novo endpoint `DELETE /tenants/:tenantId/device-sessions/:sessionId` (HTTP 204) para encerrar sessão ativa pelo admin
- **`backend/device-sessions/device-sessions.service.ts`**: novo método `closeById()` — seta `status=INTERRUPTED`, `endedAt=now`, `endedReason='admin_forced'`
- **`frontend/lib/api.ts`**: adicionado `deviceSessionsApi.close(tenantId, sessionId)`
- **`frontend/device-sessions/page.tsx`**: coluna "Ações" com botão "Encerrar" (visível apenas em linhas ACTIVE); atualiza a linha localmente após confirmação sem reload

### Decisions
- Reutilizou o fluxo `validateSession → 410` já existente no Android: o agente detecta a sessão INTERRUPTED no próximo ciclo de poll (5s) e abre `DeviceLoginActivity` automaticamente — zero mudanças no Android necessárias

---

## [0.3.3] — 2026-04-04 | APK 1.1.6 (versionCode 11)

### Summary
Correção do loop de tela preta no timeout de sessão (lockNow único + wake+keyguard para mostrar login); kiosk pendente quando app não instalado com auto-apply após instalação; avisos no front para admin sobre apps não instalados no kiosk.

### Fixed
- **`android/services/CommandPollingService.kt`**: `lockNow()` chamado repetidamente a cada 2s causava tela preta infinita — corrigido com flag `lockFired` (lockNow apenas na primeira vez, chamadas seguintes só atualizam notificação)
- **`android/services/CommandPollingService.kt`**: full-screen intent não funcionava no Android 14 para mostrar `DeviceLoginActivity` — substituído por wake lock + `setKeyguardDisabled(true)` + `startActivity()` + re-enable após 3s (Device Owner, funciona em todas as APIs)
- **`android/services/MdmPolicyService.kt`**: kiosk com app não instalado agora salva config como pendente (`pending_kiosk_apps`) em vez de abortar silenciosamente
- **`android/services/MdmPolicyService.kt`**: adicionado `applyPendingKioskIfReady()` — aplica kiosk automaticamente assim que os apps pendentes são detectados como instalados
- **`android/services/CommandPollingService.kt`**: `applyPendingKioskIfReady()` chamado a cada ciclo de polling (5s)

### Added
- **`frontend/devices/[id]/page.tsx`**: aviso ⚠️ no modal de kiosk quando apps selecionados não estão instalados no dispositivo (detectado após GET_APPS)
- **`frontend/policies/page.tsx`**: aviso ⚠️ na seção de Modo Quiosque quando app da whitelist tem APK URL mas não está nos Apps Obrigatórios

### Changed
- **`android/app/build.gradle.kts`**: versão APK `1.1.3 → 1.1.6` (versionCode 8→11, inclui 1.1.4 e 1.1.5 intermediários)

---

## [0.3.2] — 2026-04-04 | APK 1.1.3 (versionCode 8)

### Summary
Correção de tela preta ao ativar kiosk com app não instalado; prevenção de loop infinito de lockNow no watchdog de sessão; deploy de 1.1.3 em todos os emuladores.

### Fixed
- **`android/services/MdmPolicyService.kt`**: kiosk whitelist com app não instalado causava tela preta — adicionado guard `selected.isEmpty() && mode == "whitelist" → abortar` para evitar esconder todos os apps do launcher
- **`android/services/MdmPolicyService.kt`**: `enableKioskMode` usava flag `0` em `queryIntentActivities`, ignorando apps ocultos por `setApplicationHidden()` na re-ativação — corrigido com `MATCH_UNINSTALLED_PACKAGES`
- **Loop de tela preta no API34**: watchdog de sessão chamava `lockNow()` a cada 2s enquanto não havia sessão ativa, impedindo qualquer interação — recuperado via `am force-stop` + UPDATE_POLICY com `deviceUserAuthRequired: false` + `kioskMode: false`

### Changed
- **`android/app/build.gradle.kts`**: versão APK `1.1.2 → 1.1.3` (versionCode 7→8)

---

## [0.3.1] — 2026-04-04 | APK 1.1.0 (versionCode 5)

### Summary
Correções no sistema de autenticação do dispositivo: timeout de sessão agora bloqueia a tela e exibe DeviceLoginActivity automaticamente em todas as APIs; ao desativar auth na política a sessão é encerrada imediatamente; removida seção "Senha" do formulário de políticas.

### Changed
- **`android/app/build.gradle.kts`**: versão APK `1.0.3 → 1.1.0` (versionCode 4→5)
- **`android/services/CommandPollingService.kt`**: watchdog de sessão — detecta ausência de sessão a cada 2s e dispara `DeviceLoginActivity`; API < 29 usa `startActivity()` direto; API ≥ 29 usa `lockNow()` + full-screen notification com `USE_FULL_SCREEN_INTENT`
- **`android/services/UserActivityMonitorService.kt`**: ao timeout, apenas limpa sessão — watchdog do `CommandPollingService` assume o controle de exibir login
- **`android/ui/DeviceLoginActivity.kt`**: adicionado `isInForeground` (volatile) + `onResume`/`onPause` para watchdog detectar estado
- **`android/AndroidManifest.xml`**: adicionada permission `USE_FULL_SCREEN_INTENT` (obrigatória Android 12+)
- **`frontend/policies/page.tsx`**: removida seção "Senha" (Exigir Senha, Tamanho Mínimo, Máx. Tentativas) — substituída por autenticação no dispositivo
- **`frontend/types/index.ts`**: removidos campos `passwordRequired`, `minPasswordLength`, `maxFailedAttempts` do tipo `PolicyRules`

### Fixed
- Sessão não era encerrada ao desativar "Autenticação no Dispositivo" na política — adicionado `DeviceLoginActivity.clearSession()` no handler `!rules.deviceUserAuthRequired`
- `DeviceLoginActivity` não aparecia automaticamente após timeout no Android 10+ — corrigido com watchdog + full-screen notification
- Tela preta após `lockNow()` — invertida ordem: notificação postada antes do lock

---

## [0.3.0] — 2026-04-04

### Summary
Implementação de rastreamento de versão do agente E.Guardian em toda a stack (Android → Backend → Frontend), correção do bug de re-ativação do kiosk mode que escondia apps permanentemente, e persistência dos apps autorizados no banco ao ativar kiosk.

### Added
- **`android/api/MdmApiClient.kt`**: header `X-Agent-Version` adicionado ao `getPendingCommands` e `CommandPollingWorker`
- **`android/services/CommandPollingService.kt`**: passa `BuildConfig.VERSION_NAME` no header a cada poll
- **`android/services/CommandPollingWorker.kt`**: idem para o worker background
- **`backend/entities/device.entity.ts`**: coluna `agentVersion varchar(50)` adicionada
- **`backend/commands.controller.ts`**: lê header `X-Agent-Version` no endpoint `GET /device/commands/pending`
- **`backend/commands.service.ts`**: salva `agentVersion` no heartbeat a cada poll; salva `kioskApps` no `acknowledgeCommand` ao executar `ENABLE_KIOSK`; limpa `kioskApps` ao executar `DISABLE_KIOSK`
- **`frontend/types/index.ts`**: campos `agentVersion: string | null` e `kioskApps: string[]` adicionados ao tipo `Device`
- **`frontend/devices/[id]/page.tsx`**: exibe campo "Agente" na tabela de informações do device; pré-seleciona apps autorizados ao buscar lista no modal kiosk

### Fixed
- **Kiosk re-ativação**: `enableKioskMode` usava flag `0` em `queryIntentActivities`, não enxergando apps já ocultos — corrigido com `MATCH_UNINSTALLED_PACKAGES` em `MdmPolicyService.kt`
- **`kioskApps` não persistia**: `acknowledgeCommand` só salvava `isKioskMode=true`, sem salvar a lista de apps — agora salva `kioskApps` do payload do comando
- **Checkboxes desmarcados ao reabrir modal**: frontend não pré-selecionava apps já autorizados — corrigido fazendo interseção entre `device.kioskApps` e a lista retornada pelo device

### Decisions
- Versão do agente é reportada passivamente via header HTTP (sem endpoint dedicado), mantendo o poll como único canal de comunicação device→backend
- `kioskApps` persiste no banco como fonte de verdade para o frontend; o device é a fonte de verdade para o estado real

---

## [0.2.2] — 2026-04-03

### Summary
Suite completa de testes Playwright QA (44/44 passando), factory wipe + re-enrollment dos 4 emuladores com novos IDs/tokens, e diagnóstico + fix do mapa de localização no dashboard.

### Added
- **qa/tests/all.spec.js**: suite completa E2E — 44 testes cobrindo Dashboard, Devices, Policies, Apps, Commands, Device Users, Device Sessions (CSV export), Groups, detalhe de cada device (Admin Lock + unlock, Kiosk, Mensagem, Reboot, Update Policy), extras no API32 (WiFi Diagnóstico, Localizar, Kiosk ativar/desativar), Login negativo
- **qa/playwright.config.js**: configurado com timeout 60s, workers 1, headed mode, screenshot/video em falhas

### Changed
- **qa/tests/all.spec.js**: IDs dos devices atualizados após factory wipe (novos UUIDs gerados pelo re-enrollment)
- **memory/project_emulators.md**: novos IDs, tokens e comando correto de re-enrollment pós-wipe

### Fixed
- **QA — WiFi Diagnóstico**: teste falhava com "Target page closed" após reboot do API32. Fix: `waitForTimeout(12000)` antes de navegar + regex `Diagn.{0,3}stico` para acentuação
- **QA — Kiosk ativar**: clique em "Ativar Kiosk (0 apps)" crashava a página quando nenhum app disponível após reboot. Fix: guard `!activateBtnText.includes('(0 apps)')`
- **QA — Kiosk desativar**: botão "Desativar Kiosk" começa `disabled` até device acknowledge. Fix: `waitForFunction` aguarda botão habilitado
- **Mapa do Dashboard**: sem localização após wipe porque `FusedLocationProvider` precisa de warm-up no emulador. Fix: injetar localizações diretamente via `POST /api/v1/tenants/:id/geolocation` com token do device; permissões concedidas via `adb pm grant` + coordenadas via `adb emu geo fix`
- **Re-enrollment pós-wipe**: intent `DEV_ENROLL` simples não existia — action correta é `com.mdm.enterprise.DEV_ENROLL` com extras `dev_device_id`, `dev_tenant_id`, `dev_server_url`. Fluxo documentado: gerar enrollment token → `POST /enroll` → obter deviceId+token → intent

### Decisions
- Enrollment tokens são descartáveis (used=true após uso) — sempre gerar novos via `POST /tenants/:id/devices/enrollment-token` antes de re-enrollar
- `dev_server_url` deve ser sempre passado explicitamente — default hardcoded no app aponta para porta 3002 (incorreto)
- Localização no mapa pode ser injetada via API com token de device para testes — não requer GPS real no emulador

## [0.2.1] — 2026-04-02

### Summary
Migrated `.android` folder to `Q:\.android`, fixed AVD paths, resolved Vulkan crash on emulators API32/34/36, and enhanced the project-context skill with auto-detection, SemVer table, and standardized log output.

### Changed
- **Q:/.android/avd/*.ini**: updated `path=` entries from `C:\Users\elias\.android\avd\` to `Q:\.android\avd\` after folder migration
- **skills/project-context/SKILL.md**: added auto git-based change detection, SemVer classification table, proactive memory update step, and 6-block standard output format

### Fixed
- **Emulator Vulkan crash (API32/34/36)**: `0xC0000005` access violation caused by RTSS/Afterburner injecting Vulkan hooks. Fix: launch with `-gpu swiftshader_indirect` for API32/34/36
- **`.android` path broken**: moved folder to `Q:\.android`, created NTFS junction `C:\Users\elias\.android → Q:\.android` so all tools (adb, emulator, Studio) find files at the old path transparently

### Decisions
- Junction approach chosen over env var (`ANDROID_AVD_HOME`) because it fixes all tools at once without per-process config
- API25 keeps using default GPU (Vulkan works fine there); only API32+ need swiftshader workaround

## [0.2.0] — 2026-03-29

### Summary
Added concurrent session exclusivity for device users (same user cannot be active on two devices simultaneously) and fixed four bugs: double-poll coroutine leak, API 25 crash on USB policy, device-users listing 500 error, and git repository initialized.

### Changes
- **android/services/CommandPollingService.kt**: added `pollingJob: Job?` — cancels previous polling+watchdog coroutines on each `onStartCommand`, preventing duplicate poll threads on re-enroll
- **android/services/CommandPollingService.kt**: added session validation per poll cycle — calls `GET device/user-auth/session/:id/validate`, forces re-login with toast on HTTP 410
- **android/services/MdmPolicyService.kt**: guarded `setUsbDataSignalingEnabled()` with `Build.VERSION.SDK_INT >= S` (API 31) to prevent `NoSuchMethodError` crash on API 25
- **android/ui/DeviceLoginActivity.kt**: added `EXTRA_REASON` extra + Toast display on `onCreate` to show "Sessão encerrada" message when kicked by another device
- **android/api/MdmApiClient.kt**: added `validateSession` Retrofit endpoint (`GET device/user-auth/session/{sessionId}/validate`)
- **backend/device-sessions/device-sessions.service.ts**: added `closeActiveForUser()` — closes all active sessions for a user across all devices on new login
- **backend/device-sessions/device-sessions.service.ts**: added `findById()` helper
- **backend/device-user-auth/device-user-auth.service.ts**: added `validateSession()` — returns 410 Gone when session is no longer ACTIVE
- **backend/device-user-auth/device-user-auth.controller.ts**: added `GET device/user-auth/session/:sessionId/validate` route
- **backend/device-users/device-users.service.ts**: fixed `findAll` — changed `??` to `||` for page/limit defaults to handle NaN from ValidationPipe

### Fixes
- **Double-poll bug**: `onStartCommand` launched new coroutines without canceling previous ones → each re-enroll added 2 more polling loops. Fix: `pollingJob?.cancel()` + watchdog as child job.
- **API 25 USB crash**: `setUsbDataSignalingEnabled()` is API 31+ and throws `NoSuchMethodError` (a `Throwable`, not `Exception` — not caught by existing try-catch). Fix: SDK version guard.
- **Device-users 500**: `ValidationPipe` with `enableImplicitConversion: true` converts absent `@Query('page')` to `NaN`. `NaN ?? 1` returns `NaN` (nullish coalescing doesn't catch NaN). Fix: `||` operator.
- **Concurrent sessions**: `closeActiveForDevice` only closed sessions for the same device, allowing the same user to stay logged in on multiple devices. Fix: `closeActiveForUser` called on every login.

### Decisions
- Session exclusivity enforced server-side (close on login) + client-side (poll-based 410 check every 5s) for fast feedback without WebSockets
- `validateSession` is a `@Public()` endpoint — authenticated only by `X-Device-Token` header, no JWT needed
- Toast message "Sessão encerrada: login realizado em outro dispositivo" shown via `EXTRA_REASON` intent extra

---
