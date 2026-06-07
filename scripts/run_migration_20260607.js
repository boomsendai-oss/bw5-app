#!/usr/bin/env node
// Run: cd bw5-app && node scripts/run_migration_20260607.js
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

const sqlPath = path.join(__dirname, 'migrations', '20260607_string_fk_to_id.sql');
const sql = fs.readFileSync(sqlPath, 'utf-8');

// Split on semicolons, filter comments and blanks
const statements = sql
  .split(';')
  .map(s => s.replace(/--[^\n]*/g, '').trim())
  .filter(s => s.length > 0);

async function run() {
  console.log(`Executing ${statements.length} statements...\n`);

  // Pre-check: counts
  const checks = [
    ['payroll_lines total', 'SELECT COUNT(*) as c FROM payroll_lines'],
    ['studio_billing_lines total', 'SELECT COUNT(*) as c FROM studio_billing_lines'],
    ['hacomono_billing_records total', 'SELECT COUNT(*) as c FROM hacomono_billing_records'],
  ];
  for (const [label, q] of checks) {
    const r = await client.execute(q);
    console.log(`  ${label}: ${r.rows[0].c}`);
  }
  console.log('');

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 80).replace(/\n/g, ' ');
    try {
      const result = await client.execute(stmt);
      const affected = result.rowsAffected ?? 0;
      console.log(`[${i + 1}/${statements.length}] OK (${affected} rows) — ${preview}...`);
    } catch (e) {
      // If column already exists, skip gracefully
      if (e.message && e.message.includes('duplicate column name')) {
        console.log(`[${i + 1}/${statements.length}] SKIP (column already exists) — ${preview}...`);
      } else {
        console.error(`[${i + 1}/${statements.length}] FAIL — ${preview}...`);
        console.error(`  Error: ${e.message}`);
        process.exit(1);
      }
    }
  }

  // Post-check: verify no NULLs where we expect data
  console.log('\n=== Post-migration verification ===');

  const v1 = await client.execute('SELECT COUNT(*) as c FROM payroll_lines WHERE studio_name IS NOT NULL AND studio_id IS NULL');
  console.log(`payroll_lines: studio_name set but studio_id NULL = ${v1.rows[0].c}`);

  const v2 = await client.execute('SELECT COUNT(*) as c FROM payroll_lines WHERE class_name IS NOT NULL AND lesson_master_id IS NULL');
  console.log(`payroll_lines: class_name set but lesson_master_id NULL = ${v2.rows[0].c}`);

  const v3 = await client.execute("SELECT COUNT(*) as c FROM studio_billing_lines WHERE class_name IS NOT NULL AND lesson_master_id IS NULL AND class_name NOT LIKE '[%' AND class_name NOT LIKE '（%'");
  console.log(`studio_billing_lines: real class_name but lesson_master_id NULL = ${v3.rows[0].c}`);

  const v4 = await client.execute('SELECT COUNT(*) as c FROM hacomono_billing_records WHERE member_id IS NOT NULL AND boom_member_id IS NULL');
  console.log(`hacomono_billing_records: member_id set but boom_member_id NULL = ${v4.rows[0].c} (orphans)`);

  // Show orphan details
  if (Number(v4.rows[0].c) > 0) {
    const orphans = await client.execute('SELECT id, member_id, kaiin_no, product_name, billing_date FROM hacomono_billing_records WHERE member_id IS NOT NULL AND boom_member_id IS NULL');
    console.log('\nOrphan details:');
    orphans.rows.forEach(r => console.log(`  id=${r.id} member_id=${r.member_id} kaiin_no=${r.kaiin_no} product=${r.product_name} date=${r.billing_date}`));
  }

  console.log('\nDone!');
}

run().catch(e => { console.error(e); process.exit(1); });
