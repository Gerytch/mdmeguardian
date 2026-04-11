#!/bin/bash
# E.Guardian MDM — Deploy script for EC2
# Usage: bash /var/www/eguardian/scripts/deploy-ec2.sh

set -e

APP_DIR="/var/www/eguardian"
cd "$APP_DIR"

echo "=============================="
echo " E.Guardian — Deploy"
echo "=============================="

# 1. Pull latest code
echo ""
echo "[1/4] Pulling latest code..."
git pull

# 2. Build backend
echo ""
echo "[2/4] Building backend..."
cd "$APP_DIR/backend"
npm install --silent
npm run build

# 3. Build frontend
echo ""
echo "[3/4] Building frontend..."
cd "$APP_DIR/frontend"
npm install --silent
npm run build

# 4. Restart services
echo ""
echo "[4/4] Restarting services..."
pm2 restart eguardian-backend
pm2 restart eguardian-frontend

echo ""
echo "=============================="
echo " Deploy concluido com sucesso!"
echo "=============================="
pm2 status eguardian-backend eguardian-frontend
