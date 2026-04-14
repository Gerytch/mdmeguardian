#!/bin/bash
# Apply security headers to nginx config for eg.expresso3300.com.br
set -e

NGINX_CONF="/etc/nginx/sites-available/eguardian"

echo "Updating nginx config with security headers..."

sudo tee "$NGINX_CONF" > /dev/null << 'EOF'
server {
    server_name eg.expresso3300.com.br;
    client_max_body_size 50m;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Uploads (APK download)
    location /uploads/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend (tudo o mais)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/eg.expresso3300.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eg.expresso3300.com.br/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = eg.expresso3300.com.br) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name eg.expresso3300.com.br;
    client_max_body_size 50m;
    return 404;
}
EOF

echo "Testing nginx config..."
sudo nginx -t

echo "Reloading nginx..."
sudo systemctl reload nginx

echo "Done! Security headers applied."
