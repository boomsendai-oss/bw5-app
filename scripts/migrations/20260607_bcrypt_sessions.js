#!/usr/bin/env node
/**
 * Migration: bcrypt password + admin_sessions table
 *
 * 1. Creates admin_sessions table for token-based auth
 * 2. Hashes the existing plaintext admin_password with bcrypt
 *
 * Usage: node scripts/migrations/20260607_bcrypt_sessions.js
 * Requires: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN env vars
 */
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.error('TURSO_DATABASE_URL is required');
    process.exit(1);
  }

  const client = createClient({ url, authToken });

  // 1. Create admin_sessions table
  await client.execute(`CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
  )`);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_admin_sess_token ON admin_sessions(token)');
  console.log('admin_sessions table created');

  // 2. Hash existing plaintext password
  const row = await client.execute("SELECT value FROM settings WHERE key = 'admin_password'");
  if (row.rows.length === 0) {
    console.log('No admin_password found in settings, skipping hash');
    return;
  }

  const current = row.rows[0].value;
  if (typeof current === 'string' && current.startsWith('$2')) {
    console.log('admin_password is already hashed, skipping');
    return;
  }

  const hash = await bcrypt.hash(current, 10);
  await client.execute({
    sql: "UPDATE settings SET value = ? WHERE key = 'admin_password'",
    args: [hash],
  });
  console.log('admin_password hashed successfully');
}

main().catch(e => { console.error(e); process.exit(1); });
