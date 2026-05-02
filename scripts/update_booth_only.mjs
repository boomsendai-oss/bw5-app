import { createClient } from '@libsql/client';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.production.local', 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
);

const c = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

// オフィシャルTシャツ (id=4) を 当日会場販売のみ に変更
const r = await c.execute({
  sql: 'UPDATE merchandise SET purchase_at_booth = 1 WHERE id = 4',
  args: [],
});
console.log('id=4 official Tshirt purchase_at_booth set:', r.rowsAffected);

const v = await c.execute('SELECT id, name, purchase_at_booth FROM merchandise WHERE id IN (4,5,6,7,8,9) ORDER BY id');
console.log('\n--- Current settings ---');
for (const row of v.rows) {
  const tag = row.purchase_at_booth ? '[BOOTH ONLY]' : '[RESERVABLE]';
  console.log(`  id=${row.id} ${tag} ${row.name}`);
}
