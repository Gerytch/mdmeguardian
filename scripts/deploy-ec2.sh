#!/bin/bash
# E.Guardian MDM — Deploy script for EC2
#
# Usage:
#   bash scripts/deploy-ec2.sh              → deploy da tag/branch atual
#   bash scripts/deploy-ec2.sh v0.15.0      → deploy de uma tag específica
#   bash scripts/deploy-ec2.sh master       → deploy do branch master (latest)
#
# Rollback:
#   bash scripts/deploy-ec2.sh v0.15.0      → volta para a versão tageada

set -e

APP_DIR="/var/www/eguardian"
TARGET="${1:-}"
cd "$APP_DIR"

echo "=============================="
echo " E.Guardian — Deploy"
echo "=============================="

# 1. Fetch latest refs (tags + branches)
echo ""
echo "[1/5] Fetching latest refs..."
git fetch --tags --prune

# 2. Checkout target version
if [ -n "$TARGET" ]; then
  echo ""
  echo "[2/5] Checking out: $TARGET"
  git checkout "$TARGET"
else
  echo ""
  echo "[2/5] Pulling latest from current branch..."
  git pull
fi

CURRENT=$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)
echo "  → Version: $CURRENT"

# 3. Build backend
echo ""
echo "[3/5] Building backend..."
cd "$APP_DIR/backend"
npm install --silent
npm run build

# 4. Build frontend
echo ""
echo "[4/5] Building frontend..."
cd "$APP_DIR/frontend"
npm install --silent
npm run build

# 5. Restart services
echo ""
echo "[5/5] Restarting services..."
pm2 restart eguardian-backend
pm2 restart eguardian-frontend

echo ""
echo "=============================="
echo " Deploy concluido: $CURRENT"
echo "=============================="
pm2 status eguardian-backend eguardian-frontend
