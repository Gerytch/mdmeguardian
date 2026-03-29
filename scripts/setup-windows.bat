@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo  MDM SaaS - Setup Script (Windows)
echo ============================================================
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from: https://nodejs.org/en/download
    echo         Recommended: Node.js 20 LTS
    pause
    exit /b 1
)
echo [OK] Node.js found:
node --version

:: Check npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found.
    pause
    exit /b 1
)
echo [OK] npm found:
npm --version

:: Check PostgreSQL
psql --version >nul 2>&1
if errorlevel 1 (
    echo [WARN] psql not found in PATH.
    echo        Make sure PostgreSQL is installed and added to PATH.
    echo        Download: https://www.postgresql.org/download/windows/
    echo        After install, add C:\Program Files\PostgreSQL\15\bin to PATH
)

echo.
echo ============================================================
echo  Database Setup
echo ============================================================
set /p DB_HOST="Database host [localhost]: "
if "!DB_HOST!"=="" set DB_HOST=localhost
set /p DB_PORT="Database port [5432]: "
if "!DB_PORT!"=="" set DB_PORT=5432
set /p DB_NAME="Database name [mdm_saas]: "
if "!DB_NAME!"=="" set DB_NAME=mdm_saas
set /p DB_USER="Database user [mdm_user]: "
if "!DB_USER!"=="" set DB_USER=mdm_user
set /p DB_PASS="Database password [mdm_password]: "
if "!DB_PASS!"=="" set DB_PASS=mdm_password

echo.
echo Creating database and user...
psql -h !DB_HOST! -p !DB_PORT! -U postgres -c "CREATE USER !DB_USER! WITH PASSWORD '!DB_PASS!';" 2>nul
psql -h !DB_HOST! -p !DB_PORT! -U postgres -c "CREATE DATABASE !DB_NAME! OWNER !DB_USER!;" 2>nul
psql -h !DB_HOST! -p !DB_PORT! -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE !DB_NAME! TO !DB_USER!;"

echo Running migrations...
psql -h !DB_HOST! -p !DB_PORT! -U !DB_USER! -d !DB_NAME! -f ..\database\migrations\001_initial_schema.sql
psql -h !DB_HOST! -p !DB_PORT! -U !DB_USER! -d !DB_NAME! -f ..\database\seed.sql

echo.
echo ============================================================
echo  Backend Setup
echo ============================================================
cd ..\backend

if not exist ".env" (
    copy .env.example .env
    powershell -Command "(gc .env) -replace 'DATABASE_HOST=localhost', 'DATABASE_HOST=!DB_HOST!' | Out-File .env -encoding utf8"
    powershell -Command "(gc .env) -replace 'DATABASE_PORT=5432', 'DATABASE_PORT=!DB_PORT!' | Out-File .env -encoding utf8"
    powershell -Command "(gc .env) -replace 'DATABASE_NAME=mdm_saas', 'DATABASE_NAME=!DB_NAME!' | Out-File .env -encoding utf8"
    powershell -Command "(gc .env) -replace 'DATABASE_USER=mdm_user', 'DATABASE_USER=!DB_USER!' | Out-File .env -encoding utf8"
    powershell -Command "(gc .env) -replace 'DATABASE_PASSWORD=mdm_password', 'DATABASE_PASSWORD=!DB_PASS!' | Out-File .env -encoding utf8"
    echo [OK] .env created from template
)

echo Installing backend dependencies...
call npm install

echo.
echo ============================================================
echo  Frontend Setup
echo ============================================================
cd ..\frontend

if not exist ".env.local" (
    copy .env.example .env.local 2>nul
    echo [OK] .env.local created
)

echo Installing frontend dependencies...
call npm install

echo.
echo ============================================================
echo  Setup Complete!
echo ============================================================
echo.
echo To start development:
echo   Backend:  cd backend ^&^& npm run start:dev
echo   Frontend: cd frontend ^&^& npm run dev
echo.
echo Default credentials:
echo   Email:    admin@acme-corp.com
echo   Password: Admin@12345
echo   Tenant:   acme-corp
echo.
pause
