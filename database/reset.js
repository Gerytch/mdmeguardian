#!/usr/bin/env node
/**
 * E.Guardian MDM — Database Reset Script
 *
 * Apaga TODOS os dados do banco e recria apenas:
 *   - Tenant: E.Guardian
 *   - Admin: admin@eguardian.com / Admin@123
 *
 * Uso:
 *   node database/reset.js
 *
 * Requer: pg, bcrypt instalados (cd backend && npm install)
 */

const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

// Carrega .env do backend
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const DB_CONFIG = {
  host:     process.env.DATABASE_HOST     || 'localhost',
  port:     parseInt(process.env.DATABASE_PORT || '5432'),
  user:     process.env.DATABASE_USER     || 'mdm_user',
  password: process.env.DATABASE_PASSWORD || 'mdm_password_dev',
  database: process.env.DATABASE_NAME     || 'mdm_db',
};

const TENANT_ID = '2c55c328-daa0-4342-9ec9-b36864264878';
const ADMIN_EMAIL = 'admin@eguardian.com';
const ADMIN_PASSWORD = 'Admin@123';
const ADMIN_FIRST = 'Admin';
const ADMIN_LAST = 'E.Guardian';

async function reset() {
  const client = new Client(DB_CONFIG);
  await client.connect();
  console.log('✔ Conectado ao banco:', DB_CONFIG.database);

  try {
    await client.query('BEGIN');

    // 1. Apaga todos os dados em ordem (respeita FK)
    console.log('🗑  Limpando tabelas...');
    await client.query(`
      TRUNCATE TABLE
        locations,
        commands,
        apps,
        enrollment_tokens,
        device_sessions,
        device_users,
        devices,
        device_groups,
        policies,
        users,
        tenants
      RESTART IDENTITY CASCADE;
    `);

    // 2. Recria o tenant
    console.log('🏢  Criando tenant E.Guardian...');
    await client.query(`
      INSERT INTO tenants (id, name, slug, plan, "isActive")
      VALUES ($1, 'E.Guardian', 'eguardian', 'ENTERPRISE', true);
    `, [TENANT_ID]);

    // 3. Gera hash bcrypt e cria admin
    console.log('🔐  Gerando hash bcrypt (rounds=12)...');
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    await client.query(`
      INSERT INTO users ("tenantId", email, "passwordHash", "firstName", "lastName", role, "isActive")
      VALUES ($1, $2, $3, $4, $5, 'TENANT_ADMIN', true);
    `, [TENANT_ID, ADMIN_EMAIL, passwordHash, ADMIN_FIRST, ADMIN_LAST]);

    await client.query('COMMIT');

    console.log('');
    console.log('✅ Reset concluído!');
    console.log('   Tenant ID :', TENANT_ID);
    console.log('   Login     :', ADMIN_EMAIL);
    console.log('   Senha     :', ADMIN_PASSWORD);
    console.log('');
    console.log('⚠️  Lembre de fazer wipe nos emuladores Android:');
    console.log('   AVD Manager → Wipe Data  (ou adb -s <serial> shell recovery --wipe_data)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro — rollback efetuado:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

reset();
