import { createClient } from '@libsql/client';
import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.production.local', 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);
const c = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

// Check current columns
const cur = await c.execute("PRAGMA table_info(merch_orders)");
const have = new Set(cur.rows.map(r => r.name));
console.log('current columns:', [...have]);

const adds = [
  ['variant_id', 'INTEGER'],
  ['color', "TEXT DEFAULT ''"],
  ['size', "TEXT DEFAULT ''"],
  ['email', "TEXT DEFAULT ''"],
  ['square_payment_id', "TEXT DEFAULT ''"],
];

for (const [name, type] of adds) {
  if (have.has(name)) { console.log(`skip ${name} (exists)`); continue; }
  try {
    await c.execute(`ALTER TABLE merch_orders ADD COLUMN ${name} ${type}`);
    console.log(`added ${name}`);
  } catch (e) {
    console.error(`failed ${name}:`, e.message);
  }
}

const after = await c.execute("PRAGMA table_info(merch_orders)");
console.log('\nfinal columns:', after.rows.map(r => r.name));
