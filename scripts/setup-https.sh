#!/bin/bash
# Setup HTTPS com Let's Encrypt para E.Guardian homolog
# Uso: bash scripts/setup-https.sh SEU@EMAIL.COM
# Exemplo: bash scripts/setup-https.sh admin@empresa.com

set -e

DOMAIN="eg.expresso3300.com.br"
EMAIL="${1:-admin@eguardian.com}"
BACKEND_PORT=3001
FRONTEND_PORT=3000

echo "=== E.Guardian HTTPS Setup ==="
echo "Dominio: $DOMAIN"
echo "Email:   $EMAIL"
echo ""

# 1. Instalar nginx e certbot
echo "[1/5] Instalando nginx e certbot..."
apt-get update -qq && apt-get install -y -qq nginx certbot python3-certbot-nginx
echo "OK"

# 2. Remover config default do nginx
echo "[2/5] Configurando nginx..."
rm -f /etc/nginx/sites-enabled/default

# Criar config nginx para backend (porta 3001) e frontend (porta 3000)
cat > /etc/nginx/sites-available/eguardian << NGINXCONF
server {
    listen 80;
    server_name $DOMAIN;

    # Backend API
    location /api/ {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    # Uploads (APK download)
    location /uploads/ {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Frontend (tudo o mais)
    location / {
        proxy_pass http://localhost:$FRONTEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXCONF

ln -sf /etc/nginx/sites-available/eguardian /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
echo "OK"

# 3. Gerar certificado SSL
echo "[3/5] Gerando certificado Let's Encrypt..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
echo "OK"

# 4. Atualizar .env do backend com nova URL
echo "[4/5] Atualizando CORS no backend..."
ENV_FILE="/var/www/eguardian/backend/.env"
if grep -q "CORS_ORIGINS" "$ENV_FILE"; then
    sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN|" "$ENV_FILE"
else
    echo "CORS_ORIGINS=https://$DOMAIN" >> "$ENV_FILE"
fi
echo "OK"

# 5. Atualizar .env do frontend e rebuildar
echo "[5/5] Atualizando frontend e rebuilding..."
FRONT_ENV="/var/www/eguardian/frontend/.env.production.local"
echo "NEXT_PUBLIC_API_URL=https://$DOMAIN/api/v1" > "$FRONT_ENV"
cd /var/www/eguardian/frontend && npm run build
pm2 restart all
echo "OK"

echo ""
echo "=== CONCLUIDO ==="
echo "Backend API: https://$DOMAIN/api/v1/health"
echo "Frontend:    https://$DOMAIN"
echo ""
echo "Teste: curl -s -o /dev/null -w '%{http_code}' https://$DOMAIN/api/v1/health"
