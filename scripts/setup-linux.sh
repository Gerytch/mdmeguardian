#!/usr/bin/env bash
set -e

echo "============================================================"
echo " MDM SaaS - Setup Script (Linux/macOS)"
echo "============================================================"
echo

# ─── Check Node.js ───────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found."
  echo "  Install via nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  echo "  Then: nvm install 20 && nvm use 20"
  exit 1
fi
echo "[OK] Node.js: $(node --version)"

# ─── Check PostgreSQL ────────────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  echo "[WARN] psql not found."
  echo "  Ubuntu/Debian: sudo apt install postgresql postgresql-contrib"
  echo "  macOS:         brew install postgresql@15"
  echo "  Then start: sudo systemctl start postgresql (Linux)"
  echo "              brew services start postgresql@15 (macOS)"
fi

# ─── DB Configuration ────────────────────────────────────────────────────────
echo
echo "Database Configuration"
echo "----------------------"
read -rp "Host [localhost]: " DB_HOST; DB_HOST="${DB_HOST:-localhost}"
read -rp "Port [5432]: " DB_PORT; DB_PORT="${DB_PORT:-5432}"
read -rp "Database [mdm_saas]: " DB_NAME; DB_NAME="${DB_NAME:-mdm_saas}"
read -rp "User [mdm_user]: " DB_USER; DB_USER="${DB_USER:-mdm_user}"
read -rsp "Password [mdm_password]: " DB_PASS; DB_PASS="${DB_PASS:-mdm_password}"
echo

# ─── Create DB ───────────────────────────────────────────────────────────────
echo "Creating database and user..."
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo "Running migrations..."
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f ../database/migrations/001_initial_schema.sql
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f ../database/seed.sql

# ─── Backend ─────────────────────────────────────────────────────────────────
echo
echo "Backend Setup"
echo "-------------"
cd ../backend

if [ ! -f ".env" ]; then
  cp .env.example .env
  sed -i "s/DATABASE_HOST=localhost/DATABASE_HOST=$DB_HOST/" .env
  sed -i "s/DATABASE_PORT=5432/DATABASE_PORT=$DB_PORT/" .env
  sed -i "s/DATABASE_NAME=mdm_saas/DATABASE_NAME=$DB_NAME/" .env
  sed -i "s/DATABASE_USER=mdm_user/DATABASE_USER=$DB_USER/" .env
  sed -i "s/DATABASE_PASSWORD=mdm_password/DATABASE_PASSWORD=$DB_PASS/" .env
  echo "[OK] .env created"
fi

echo "Installing backend dependencies..."
npm install

# ─── Frontend ────────────────────────────────────────────────────────────────
echo
echo "Frontend Setup"
echo "--------------"
cd ../frontend

[ ! -f ".env.local" ] && cp .env.example .env.local 2>/dev/null || true
echo "Installing frontend dependencies..."
npm install

# ─── Done ────────────────────────────────────────────────────────────────────
echo
echo "============================================================"
echo " Setup Complete!"
echo "============================================================"
echo
echo "To start development:"
echo "  Backend:  cd backend && npm run start:dev   (port 3000)"
echo "  Frontend: cd frontend && npm run dev         (port 3001)"
echo
echo "Default credentials:"
echo "  Email:    admin@acme-corp.com"
echo "  Password: Admin@12345"
echo "  Tenant:   acme-corp"
echo
echo "API Docs: http://localhost:3000/api/v1/docs"
