# E.Guardian — Deploy em EC2 Linux (Sem Docker)

> Ubuntu 22.04 LTS · Node 20 · PostgreSQL 15 · PM2 · Nginx

---

## REPOSITÓRIO GIT

O projeto está no GitHub — o deploy é feito via `git clone` / `git pull`.
Não é necessário enviar arquivos manualmente (`node_modules`, `.next`, `dist` e `.env` nunca vão para o git).

**Repositório:** `https://github.com/Gerytch/mdmeguardian`

> `.env` e `.env.local` são criados **manualmente na EC2** (ver PASSO 4).
> `backend/uploads/` é criado com `mkdir` na EC2 (ver PASSO 3).

---

## PASSO 1 — Preparar a EC2

Conecte na EC2 e rode tudo abaixo:

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar PostgreSQL 15
sudo apt install -y postgresql postgresql-contrib

# Instalar Nginx
sudo apt install -y nginx

# Instalar PM2 (gerenciador de processos)
sudo npm install -g pm2

# Criar diretórios do projeto
sudo mkdir -p /var/www/eguardian
sudo mkdir -p /var/log/eguardian
sudo chown -R ubuntu:ubuntu /var/www/eguardian /var/log/eguardian
```

---

## PASSO 2 — Configurar o Banco de Dados

```bash
# Criar usuário e banco
sudo -u postgres psql << 'EOF'
CREATE USER mdm_user WITH PASSWORD 'TROQUE_ESTA_SENHA';
CREATE DATABASE mdm_db OWNER mdm_user;
GRANT ALL PRIVILEGES ON DATABASE mdm_db TO mdm_user;
EOF

# Rodar a migration inicial (após enviar os arquivos)
psql -U mdm_user -h localhost -d mdm_db \
  -f /var/www/eguardian/database/migrations/001_initial_schema.sql
```

> Quando pedir senha, use a que você definiu acima.

---

## PASSO 3 — Clonar o Repositório na EC2

```bash
cd /var/www

# Clonar o repositório (primeira vez)
git clone https://github.com/Gerytch/mdmeguardian.git eguardian

# Criar diretório de uploads (não está no git)
mkdir -p /var/www/eguardian/backend/uploads/apks
mkdir -p /var/www/eguardian/backend/uploads/agent
```

**Copie o APK do agente para a EC2** (rode no Windows):

```bash
# Copiar o APK de homolog para a pasta de uploads
scp /c/claude/e.guardian-master/android/app/build/outputs/apk/homolog/app-homolog.apk \
  ubuntu@SEU_IP_EC2:/var/www/eguardian/backend/uploads/eguardian-agent.apk
```

> Este é o APK que aparecerá no botão "Baixar E.Guardian APK" no frontend.

---

## PASSO 4 — Variáveis de Ambiente

### Backend — crie o arquivo `/var/www/eguardian/backend/.env`:

```bash
nano /var/www/eguardian/backend/.env
```

Cole e preencha:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://mdm_user:TROQUE_ESTA_SENHA@localhost:5432/mdm_db
JWT_SECRET=gere_uma_chave_aleatoria_longa_aqui
JWT_REFRESH_SECRET=gere_outra_chave_aleatoria_longa_aqui
CORS_ORIGINS=http://SEU_IP_EC2
UPLOADS_DIR=/var/www/eguardian/backend/uploads
```

> Para gerar chaves seguras: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### Frontend — crie o arquivo `/var/www/eguardian/frontend/.env.local`:

```bash
nano /var/www/eguardian/frontend/.env.local
```

Cole e preencha:

```env
NEXT_PUBLIC_API_URL=http://SEU_IP_EC2/api/v1
```

---

## PASSO 5 — Build do Backend

```bash
cd /var/www/eguardian/backend
npm ci --omit=dev
npm run build
```

---

## PASSO 6 — Build do Frontend

> **Atenção:** Se sua EC2 for t3.micro ou t2.micro (menos de 2GB de RAM),
> faça o build do frontend **no seu Windows** e envie a pasta `.next` pronta.

### Opção A — Build na EC2 (t3.small ou maior):

```bash
cd /var/www/eguardian/frontend
npm ci --omit=dev
npm run build
```

### Opção B — Build no Windows e enviar (t3.micro):

No Windows (PowerShell):

```powershell
cd C:\claude\e.guardian-master\frontend

# Criar .env.production apontando para a EC2
"NEXT_PUBLIC_API_URL=http://SEU_IP_EC2/api/v1" | Out-File .env.production -Encoding utf8

npm run build
```

Enviar a pasta `.next` para a EC2 (Git Bash):

```bash
scp -r /c/claude/e.guardian-master/frontend/.next \
  ubuntu@SEU_IP_EC2:/var/www/eguardian/frontend/.next
```

---

## PASSO 7 — Iniciar com PM2

```bash
cd /var/www/eguardian
pm2 start ecosystem.config.js

# Verificar se está rodando
pm2 status

# Salvar para auto-iniciar no boot
pm2 save
pm2 startup
# ↑ Esse comando vai imprimir um comando sudo — copie e rode ele
```

Verificar logs se tiver algum erro:

```bash
pm2 logs eguardian-backend --lines 50
pm2 logs eguardian-frontend --lines 50
```

---

## PASSO 8 — Configurar Nginx

```bash
sudo nano /etc/nginx/sites-available/eguardian
```

Cole o conteúdo abaixo:

```nginx
server {
    listen 80;
    server_name SEU_IP_EC2;

    # Limite para upload de APK
    client_max_body_size 200M;

    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Arquivos de upload (serve direto, sem passar pelo Node)
    location /uploads {
        alias /var/www/eguardian/backend/uploads;
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

Ativar e reiniciar:

```bash
sudo ln -s /etc/nginx/sites-available/eguardian /etc/nginx/sites-enabled/
sudo nginx -t          # deve mostrar "syntax is ok"
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## PASSO 9 — Security Group da EC2 (AWS Console)

Acesse o Security Group da sua instância e configure:

| Tipo | Porta | Origem | Motivo |
|------|-------|--------|--------|
| SSH | 22 | Seu IP | Acesso remoto |
| HTTP | 80 | 0.0.0.0/0 | Frontend + API |
| HTTPS | 443 | 0.0.0.0/0 | Futuro (SSL) |

**Fechar tudo mais** — portas 3000, 3001, 5432 não devem ser acessíveis externamente.

---

## PASSO 10 — APK de Homologação

O APK precisa apontar para o IP da EC2 (não mais `10.0.2.2`).

No `android/app/build.gradle.kts`, adicione dentro do bloco `buildTypes`:

```kotlin
create("homolog") {
    isDebuggable = true
    isMinifyEnabled = false
    applicationIdSuffix = ".homolog"
    buildConfigField("String", "API_BASE_URL", "\"http://SEU_IP_EC2/api/v1\"")
    manifestPlaceholders["usesCleartextTraffic"] = "true"
}
```

Build e instalar:

```bash
cd android
./gradlew.bat assembleHomolog

# O APK gerado estará em:
# android/app/build/outputs/apk/homolog/app-homolog.apk

# Enviar para a EC2 (botão de download no painel)
scp app/build/outputs/apk/homolog/app-homolog.apk \
  ubuntu@SEU_IP_EC2:/var/www/eguardian/backend/uploads/eguardian-agent.apk
```

---

## VERIFICAÇÃO FINAL

Após tudo, teste:

```bash
# Backend respondendo
curl http://SEU_IP_EC2/api/v1/health

# Frontend abrindo
curl -I http://SEU_IP_EC2

# APK acessível
curl -I http://SEU_IP_EC2/uploads/eguardian-agent.apk
```

Acesse no navegador: `http://SEU_IP_EC2`
Login: `admin@eguardian.com` / `Admin@123`

---

## ATUALIZAR O SISTEMA (deploys futuros)

No seu Windows, após commitar e fazer push:

```bash
git add .
git commit -m "fix: descrição da mudança"
git push homolog master
```

Na EC2 — pull e rebuild:

```bash
cd /var/www/eguardian
git pull origin master

# Rebuild backend
cd /var/www/eguardian/backend && npm ci --omit=dev && npm run build

# Rebuild frontend (ou envie .next do Windows se for t3.micro)
cd /var/www/eguardian/frontend && npm ci --omit=dev && npm run build

pm2 restart all
```

---

## COMANDOS ÚTEIS NO DIA A DIA

```bash
pm2 status                          # ver se está rodando
pm2 restart eguardian-backend       # reiniciar só o backend
pm2 logs eguardian-backend          # ver logs em tempo real
sudo systemctl status nginx         # status do nginx
sudo systemctl status postgresql    # status do banco

# Backup do banco
pg_dump -U mdm_user mdm_db > backup_$(date +%Y%m%d).sql
```
