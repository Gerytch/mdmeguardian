#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║   E.Guardian MDM — Test All Emulators                                   ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║  Uso: bash test-all-emulators.sh [opções]                               ║
# ║                                                                          ║
# ║  Opções:                                                                 ║
# ║    (sem flags)         Fluxo completo: sobe tudo, instala, enrolla, logs ║
# ║    --only-logs         Só abre logcat (emuladores já rodando)            ║
# ║    --only-emulators    Sobe emuladores + setup, sem backend/frontend     ║
# ║    --stop              Para todos os emuladores                          ║
# ║    --rebuild           Rebuilda APK antes de instalar                    ║
# ║    --no-install        Pula instalação do APK                            ║
# ║    --no-device-owner   Pula set-device-owner                             ║
# ║    --no-enroll         Pula enrollment (útil se já enrollado)            ║
# ║    --wipe              Inicia emuladores com -wipe-data (factory reset)  ║
# ║    --logs-all          Logcat sem filtro (todos os logs)                 ║
# ║    --device LABEL      Roda só para um emulador: API25|API32|API34|API36 ║
# ║    --status            Mostra quais emuladores estão online              ║
# ║    -h, --help          Mostra esta ajuda                                 ║
# ╚══════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Android SDK ──────────────────────────────────────────────────────────────
SDK="$(cygpath "$LOCALAPPDATA")/Android/Sdk"
EMULATOR="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"
APK="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

# ── App ──────────────────────────────────────────────────────────────────────
PACKAGE="com.mdm.enterprise.debug"
ADMIN_RECEIVER="$PACKAGE/com.mdm.enterprise.admin.MdmDeviceAdminReceiver"
MAIN_ACTIVITY="$PACKAGE/com.mdm.enterprise.ui.MainActivity"
API_URL="http://localhost:3001/api/v1"
ANDROID_API_URL="http://10.0.2.2:3001/api/v1"

# ── Emuladores (todos) ───────────────────────────────────────────────────────
ALL_AVDS=("EGuardian_API25" "EGuardian_API32" "EGuardian_API34" "EGuardian_API36")
ALL_LABELS=("API25" "API32" "API34" "API36")
ALL_PORTS=(5554 5556 5558 5560)

# ── Flags (defaults) ─────────────────────────────────────────────────────────
OPT_ONLY_LOGS=0
OPT_ONLY_EMULATORS=0
OPT_STOP=0
OPT_REBUILD=0
OPT_NO_INSTALL=0
OPT_NO_DEVICE_OWNER=0
OPT_NO_ENROLL=0
OPT_WIPE=0
OPT_LOGS_ALL=0
OPT_STATUS=0
OPT_DEVICE=""   # vazio = todos

# ── Cores ─────────────────────────────────────────────────────────────────────
C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_YELLOW='\033[1;33m'
C_CYAN='\033[0;36m';  C_BOLD='\033[1m';   C_NC='\033[0m'

log()  { echo -e "${C_GREEN}[MASTER]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_NC}  $*"; }
err()  { echo -e "${C_RED}[ERROR]${C_NC}  $*"; }
sep()  { echo -e "${C_GREEN}──────────────────────────────────────────────${C_NC}"; }

show_help() {
  sed -n '/^# ╔/,/^# ╚/p' "$0" | sed 's/^# //' | sed 's/^#//'
  exit 0
}

# ════════════════════════════════════════════════════════════════════════════
# Parse de argumentos
# ════════════════════════════════════════════════════════════════════════════
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)          show_help ;;
    --only-logs)        OPT_ONLY_LOGS=1 ;;
    --only-emulators)   OPT_ONLY_EMULATORS=1 ;;
    --stop)             OPT_STOP=1 ;;
    --rebuild)          OPT_REBUILD=1 ;;
    --no-install)       OPT_NO_INSTALL=1 ;;
    --no-device-owner)  OPT_NO_DEVICE_OWNER=1 ;;
    --no-enroll)        OPT_NO_ENROLL=1 ;;
    --wipe)             OPT_WIPE=1 ;;
    --logs-all)         OPT_LOGS_ALL=1 ;;
    --status)           OPT_STATUS=1 ;;
    --device)
      shift
      OPT_DEVICE="${1:-}"
      if [[ -z "$OPT_DEVICE" ]]; then err "--device requer um label: API25|API32|API34|API36"; exit 1; fi
      ;;
    _logcat) # sub-comando interno
      SERIAL="$2"; LABEL="$3"; LOGS_ALL="${4:-0}"
      echo "[$LABEL] Aguardando device online..."
      "$ADB" -s "$SERIAL" wait-for-device 2>/dev/null || true
      echo "[$LABEL] Logcat iniciado — Ctrl+C para parar"
      echo "───────────────────────────────────────────────"
      if [[ "$LOGS_ALL" == "1" ]]; then
        "$ADB" -s "$SERIAL" logcat -v time 2>&1 | while IFS= read -r line; do
          if echo "$line" | grep -qiE "error|fatal|exception|crash"; then
            echo -e "\033[0;31m[$LABEL] $line\033[0m"
          elif echo "$line" | grep -qiE "warn"; then
            echo -e "\033[1;33m[$LABEL] $line\033[0m"
          else
            echo "[$LABEL] $line"
          fi
        done
      else
        "$ADB" -s "$SERIAL" logcat -v time \
          CommandPollingService:V MdmPolicyService:V MdmApiClient:V \
          AdminLockActivity:V KioskModeService:V MdmDeviceAdminReceiver:V \
          MainActivity:V AndroidRuntime:E "System.err:W" "*:S" 2>&1 \
          | while IFS= read -r line; do
            if echo "$line" | grep -qiE "error|fatal|exception|crash|FATAL"; then
              echo -e "\033[0;31m[$LABEL] $line\033[0m"
            elif echo "$line" | grep -qiE "warn"; then
              echo -e "\033[1;33m[$LABEL] $line\033[0m"
            else
              echo "[$LABEL] $line"
            fi
          done
      fi
      read -rp "Logcat encerrado. Enter para fechar..."
      exit 0
      ;;
    *) err "Opção desconhecida: $1 (use --help)"; exit 1 ;;
  esac
  shift
done

# ── Filtra emuladores se --device passado ─────────────────────────────────────
AVDS=(); LABELS=(); PORTS=()
for i in "${!ALL_AVDS[@]}"; do
  if [[ -z "$OPT_DEVICE" || "${ALL_LABELS[$i]}" == "$OPT_DEVICE" ]]; then
    AVDS+=("${ALL_AVDS[$i]}")
    LABELS+=("${ALL_LABELS[$i]}")
    PORTS+=("${ALL_PORTS[$i]}")
  fi
done

if [[ ${#AVDS[@]} -eq 0 ]]; then
  err "Device '$OPT_DEVICE' não encontrado. Opções: API25 API32 API34 API36"
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════════
# --stop: para todos os emuladores
# ════════════════════════════════════════════════════════════════════════════
if [[ $OPT_STOP -eq 1 ]]; then
  echo ""
  log "Parando emuladores..."
  for i in "${!AVDS[@]}"; do
    SERIAL="emulator-${PORTS[$i]}"
    LABEL="${LABELS[$i]}"
    if "$ADB" -s "$SERIAL" get-state > /dev/null 2>&1; then
      "$ADB" -s "$SERIAL" emu kill 2>/dev/null || true
      log "$LABEL ($SERIAL) — encerrado"
    else
      warn "$LABEL ($SERIAL) — não estava rodando"
    fi
  done
  log "Pronto."
  exit 0
fi

# ════════════════════════════════════════════════════════════════════════════
# --status: mostra quais emuladores estão online
# ════════════════════════════════════════════════════════════════════════════
if [[ $OPT_STATUS -eq 1 ]]; then
  echo ""
  echo -e "${C_BOLD}Status dos emuladores:${C_NC}"
  sep
  for i in "${!ALL_AVDS[@]}"; do
    SERIAL="emulator-${ALL_PORTS[$i]}"
    LABEL="${ALL_LABELS[$i]}"
    if "$ADB" -s "$SERIAL" get-state > /dev/null 2>&1; then
      STATE=$("$ADB" -s "$SERIAL" get-state 2>/dev/null)
      BOOT=$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
      ENROLLED=$("$ADB" -s "$SERIAL" shell \
        "cat /data/data/$PACKAGE/shared_prefs/secure_prefs.xml 2>/dev/null | grep -c 'is_enrolled' || echo 0" 2>/dev/null | tr -d '\r\n')
      STATUS_ICON="${C_GREEN}●${C_NC}"
      [[ "$BOOT" != "1" ]] && STATUS_ICON="${C_YELLOW}◐${C_NC}"
      echo -e "  $STATUS_ICON  ${C_CYAN}$LABEL${C_NC}  $SERIAL  state=$STATE  boot=$BOOT  enrolled=$ENROLLED"
    else
      echo -e "  ${C_RED}○${C_NC}  ${C_CYAN}$LABEL${C_NC}  $SERIAL  offline"
    fi
  done
  echo ""
  exit 0
fi

# ════════════════════════════════════════════════════════════════════════════
# --only-logs: abre janelas de logcat para emuladores já rodando
# ════════════════════════════════════════════════════════════════════════════
if [[ $OPT_ONLY_LOGS -eq 1 ]]; then
  log "Abrindo logcat para emuladores ativos..."
  SCRIPT_WIN="$(cygpath -w "$SCRIPT_DIR/test-all-emulators.sh")"
  FOUND=0
  for i in "${!AVDS[@]}"; do
    SERIAL="emulator-${PORTS[$i]}"
    LABEL="${LABELS[$i]}"
    if "$ADB" -s "$SERIAL" get-state > /dev/null 2>&1; then
      log "  → $LABEL ($SERIAL)"
      cmd //c start "Logcat — $LABEL" bash --login -c \
        "\"$SCRIPT_WIN\" _logcat \"$SERIAL\" \"$LABEL\" \"$OPT_LOGS_ALL\""
      FOUND=$((FOUND+1))
    else
      warn "$LABEL ($SERIAL) não está online — pulando"
    fi
  done
  [[ $FOUND -eq 0 ]] && err "Nenhum emulador online. Use o script sem --only-logs para subir."
  exit 0
fi

# ════════════════════════════════════════════════════════════════════════════
# MAIN — fluxo completo
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${C_GREEN}╔══════════════════════════════════════════════════════╗${C_NC}"
echo -e "${C_GREEN}║   E.Guardian MDM — Test Suite                       ║${C_NC}"
TARGET_DESC="[${LABELS[*]}]"
printf "${C_GREEN}║   Alvo: %-44s║${C_NC}\n" "$TARGET_DESC"
echo -e "${C_GREEN}╚══════════════════════════════════════════════════════╝${C_NC}"
echo ""

# ── Pré-checks ────────────────────────────────────────────────────────────────
if [[ ! -x "$EMULATOR" ]]; then
  err "Emulator não encontrado: $EMULATOR"; exit 1
fi

# ── --rebuild: rebuilda APK ───────────────────────────────────────────────────
if [[ $OPT_REBUILD -eq 1 ]]; then
  log "Rebuilding APK..."
  (cd "$PROJECT_ROOT/android" && ./gradlew assembleDebug)
  log "APK buildado com sucesso!"
  sep
fi

if [[ $OPT_NO_INSTALL -eq 0 && ! -f "$APK" ]]; then
  err "APK não encontrado: $APK"
  err "Use --rebuild ou: cd android && ./gradlew assembleDebug"
  exit 1
fi

# ── Backend + Frontend ────────────────────────────────────────────────────────
if [[ $OPT_ONLY_EMULATORS -eq 0 ]]; then
  if curl -s --max-time 3 -o /dev/null "http://localhost:3001" > /dev/null 2>&1; then
    log "Backend já rodando em :3001 — pulando"
  else
    log "Subindo Backend (NestJS :3001)..."
    BACKEND_WIN="$(cygpath -w "$PROJECT_ROOT/backend")"
    cmd //c start "Backend - NestJS :3001" cmd /k \
      "cd /d \"$BACKEND_WIN\" && node dist/main.js || (npx nest build && node dist/main.js)"
  fi

  if curl -s --max-time 3 -o /dev/null "http://localhost:3000" > /dev/null 2>&1; then
    log "Frontend já rodando em :3000 — pulando"
  else
    log "Subindo Frontend (Next.js :3000)..."
    FRONTEND_WIN="$(cygpath -w "$PROJECT_ROOT/frontend")"
    cmd //c start "Frontend - Next.js :3000" cmd /k \
      "cd /d \"$FRONTEND_WIN\" && npm run dev"
  fi

  log "Aguardando backend..."
  for attempt in $(seq 1 30); do
    curl -s --max-time 3 -o /dev/null "http://localhost:3001" > /dev/null 2>&1 && break || true
    echo -n "."; sleep 3
  done
  echo ""
  log "Backend OK"
  sep
fi

# ── Login → JWT + tenantId ────────────────────────────────────────────────────
if [[ $OPT_NO_ENROLL -eq 0 ]]; then
  log "Autenticando..."
  LOGIN_RESP=$(curl -sf -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@eguardian.com","password":"Admin@123"}') || {
    err "Falha na autenticação — backend está rodando?"; exit 1
  }
  JWT=$(echo "$LOGIN_RESP"      | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
  TENANT_ID=$(echo "$LOGIN_RESP" | grep -o '"tenantId":"[^"]*"'   | cut -d'"' -f4)

  if [[ -z "$JWT" || -z "$TENANT_ID" ]]; then
    err "Login falhou. Resposta: $LOGIN_RESP"; exit 1
  fi
  log "Autenticado. TenantID: $TENANT_ID"
  sep

  # ── Gera enrollment tokens ─────────────────────────────────────────────────
  log "Gerando enrollment tokens (${#AVDS[@]} devices)..."
  declare -a DEVICE_TOKENS DEVICE_IDS
  for i in "${!AVDS[@]}"; do
    LABEL="${LABELS[$i]}"
    TOKEN_RESP=$(curl -sf -X POST "$API_URL/tenants/$TENANT_ID/devices/enrollment-token" \
      -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
      -d '{}') || { warn "$LABEL: falha ao gerar token"; continue; }

    ENROLL_TOKEN=$(echo "$TOKEN_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    [[ -z "$ENROLL_TOKEN" ]] && { warn "$LABEL: token vazio — $TOKEN_RESP"; continue; }

    ENROLL_RESP=$(curl -sf -X POST "$API_URL/tenants/$TENANT_ID/devices/enroll" \
      -H "Content-Type: application/json" \
      -d "{
        \"enrollmentToken\": \"$ENROLL_TOKEN\",
        \"name\": \"Emulator ${LABEL}\",
        \"serialNumber\": \"EMU_${LABEL}_$(date +%s)\",
        \"model\": \"Android Emulator\",
        \"manufacturer\": \"Google\",
        \"androidVersion\": \"$(echo "$LABEL" | sed 's/API//')\"
      }") || { warn "$LABEL: falha no enroll"; continue; }

    DEVICE_TOKENS[$i]=$(echo "$ENROLL_RESP" | grep -o '"deviceToken":"[^"]*"' | cut -d'"' -f4)
    DEVICE_IDS[$i]=$(echo "$ENROLL_RESP"    | grep -o '"id":"[^"]*"'          | cut -d'"' -f4)

    if [[ -n "${DEVICE_TOKENS[$i]:-}" && -n "${DEVICE_IDS[$i]:-}" ]]; then
      log "$LABEL → ID: ${DEVICE_IDS[$i]:0:18}... | Token: ${DEVICE_TOKENS[$i]:0:16}..."
    else
      warn "$LABEL: enrollment incompleto — $ENROLL_RESP"
    fi
  done
  sep
fi

# ── Inicia emuladores ─────────────────────────────────────────────────────────
log "Iniciando ${#AVDS[@]} emulador(es) em paralelo..."
EMU_EXTRA_FLAGS="-memory 2048 -cores 2 -gpu auto"
[[ $OPT_WIPE -eq 1 ]] && EMU_EXTRA_FLAGS="$EMU_EXTRA_FLAGS -wipe-data"

for i in "${!AVDS[@]}"; do
  AVD="${AVDS[$i]}"; PORT="${PORTS[$i]}"; LABEL="${LABELS[$i]}"
  log "  → $AVD (porta $PORT)"
  # shellcheck disable=SC2086
  "$EMULATOR" -avd "$AVD" -no-snapshot-load -port "$PORT" \
    $EMU_EXTRA_FLAGS > "/tmp/emu_${LABEL}.log" 2>&1 &
done
log "Emuladores iniciando em background..."
sep

# ── Setup por emulador (paralelo) ─────────────────────────────────────────────
setup_emulator() {
  set +e  # comandos não-fatais (dpm, install) não devem matar o setup
  local i=$1
  local SERIAL="emulator-${PORTS[$i]}"
  local LABEL="${LABELS[$i]}"
  local DEVICE_TOKEN="${DEVICE_TOKENS[$i]:-}"
  local DEVICE_ID="${DEVICE_IDS[$i]:-}"
  local TENANT_REF="${TENANT_ID:-}"

  echo "[$LABEL] Aguardando boot..."
  "$ADB" -s "$SERIAL" wait-for-device 2>/dev/null
  local ELAPSED=0
  while true; do
    local BOOT
    BOOT=$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
    [[ "$BOOT" == "1" ]] && break
    sleep 3; ELAPSED=$((ELAPSED+3))
    [[ $ELAPSED -ge 180 ]] && { echo "[$LABEL] TIMEOUT boot"; return 1; }
  done
  echo "[$LABEL] Boot completo!"

  if [[ $OPT_NO_INSTALL -eq 0 ]]; then
    echo "[$LABEL] Instalando APK..."
    "$ADB" -s "$SERIAL" install -r "$APK" > /dev/null 2>&1 \
      && echo "[$LABEL] APK instalado!" \
      || echo "[$LABEL] APK já instalado (ok)"
  fi

  if [[ $OPT_NO_DEVICE_OWNER -eq 0 ]]; then
    echo "[$LABEL] Setando Device Owner..."
    local DPM_OUT
    DPM_OUT=$("$ADB" -s "$SERIAL" shell dpm set-device-owner "$ADMIN_RECEIVER" 2>&1)
    echo "$DPM_OUT" | grep -qi "success\|already" \
      && echo "[$LABEL] Device Owner OK" \
      || echo "[$LABEL] Device Owner: $DPM_OUT"
  fi

  if [[ $OPT_NO_ENROLL -eq 0 && -n "$DEVICE_TOKEN" && -n "$DEVICE_ID" ]]; then
    echo "[$LABEL] Enrollando via ADB..."
    "$ADB" -s "$SERIAL" shell am start \
      -n "$MAIN_ACTIVITY" \
      -a "com.mdm.enterprise.DEV_ENROLL" \
      --es dev_device_token "$DEVICE_TOKEN" \
      --es dev_device_id    "$DEVICE_ID" \
      --es dev_tenant_id    "$TENANT_REF" \
      --es dev_server_url   "$ANDROID_API_URL" \
      > /dev/null 2>&1
    echo "[$LABEL] Enrollment enviado!"
  elif [[ $OPT_NO_ENROLL -eq 1 ]]; then
    echo "[$LABEL] Enrollment pulado (--no-enroll)"
  else
    echo "[$LABEL] AVISO: sem token — enrollment pulado"
  fi

  echo "[$LABEL] Setup concluído!"
}

log "Configurando emuladores (em paralelo)..."
PIDS=()
for i in "${!AVDS[@]}"; do
  setup_emulator "$i" &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do
  wait "$pid" || warn "Setup com erro (ver acima)"
done
sep
log "Todos configurados!"
sep

# ── Logcat por emulador ───────────────────────────────────────────────────────
log "Abrindo janelas de logcat..."
SCRIPT_WIN="$(cygpath -w "$SCRIPT_DIR/test-all-emulators.sh")"
for i in "${!AVDS[@]}"; do
  SERIAL="emulator-${PORTS[$i]}"; LABEL="${LABELS[$i]}"
  cmd //c start "Logcat — $LABEL" bash --login -c \
    "\"$SCRIPT_WIN\" _logcat \"$SERIAL\" \"$LABEL\" \"$OPT_LOGS_ALL\""
done

# ── Resumo ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_GREEN}╔══════════════════════════════════════════════════════╗${C_NC}"
echo -e "${C_GREEN}║   Ambiente MDM ativo                                ║${C_NC}"
echo -e "${C_GREEN}╚══════════════════════════════════════════════════════╝${C_NC}"
echo ""
echo -e "  Backend:   ${C_CYAN}http://localhost:3001${C_NC}"
echo -e "  Frontend:  ${C_CYAN}http://localhost:3000${C_NC}"
echo -e "  Login:     ${C_CYAN}admin@eguardian.com / Admin@123${C_NC}"
echo ""
echo "  Emuladores:"
for i in "${!AVDS[@]}"; do
  DID="${DEVICE_IDS[$i]:-n/a}"
  echo -e "    ${C_CYAN}emulator-${PORTS[$i]}${C_NC}  ${LABELS[$i]}  DeviceID: ${DID:0:18}..."
done
echo ""
echo -e "  ${C_RED}Erros = VERMELHO${C_NC}  ${C_YELLOW}Warnings = AMARELO${C_NC}"
echo ""
log "Ctrl+C para encerrar o orchestrador (emuladores continuam rodando)"
wait
