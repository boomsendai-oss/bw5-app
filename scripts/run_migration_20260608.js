#!/usr/bin/env node
// Run: cd bw5-app && node scripts/run_migration_20260608.js
// Reads .env.production.local for TURSO_DATABASE_URL / TURSO_AUTH_TOKEN

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

// Parse .env manually (no dotenv dependency)
const envPath = path.join(__dirname, '..', '.env.production.local');
const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) env[m[1]] = m[2];
}

const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

const sqlPath = path.join(__dirname, 'migrations', '20260608_staff_notifications.sql');
const sql = fs.readFileSync(sqlPath, 'utf-8');

// Split on semicolons, filter comments and blanks
const statements = sql
  .split(';')
  .map(s => s.replace(/--[^\n]*/g, '').trim())
  .filter(s => s.length > 0);

async function run() {
  console.log(`Executing ${statements.length} statements...\n`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 80).replace(/\n/g, ' ');
    try {
      const result = await client.execute(stmt);
      const affected = result.rowsAffected ?? 0;
      console.log(`[${i + 1}/${statements.length}] OK (${affected} rows) — ${preview}...`);
    } catch (e) {
      if (e.message && (e.message.includes('already exists') || e.message.includes('duplicate'))) {
        console.log(`[${i + 1}/${statements.length}] SKIP (already exists) — ${preview}...`);
      } else {
        console.error(`[${i + 1}/${statements.length}] FAIL — ${preview}...`);
        console.error(`  Error: ${e.message}`);
        process.exit(1);
      }
    }
  }

  // Verify
  const count = await client.execute('SELECT COUNT(*) as c FROM staff_notifications');
  console.log(`\nVerification: staff_notifications row count = ${count.rows[0].c}`);
  console.log('Done!');
}

run().catch(e => { console.error(e); process.exit(1); });
