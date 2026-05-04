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

const updates = [
  ['lottery_normal_probability', '0.07'],
  ['lottery_normal_cap', '10'],
  ['lottery_jackpot_probability', '0.02'],
  ['lottery_jackpot_cap', '1'],
];

for (const [key, value] of updates) {
  await c.execute({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: [key, value],
  });
  console.log(`set ${key} = ${value}`);
}

const r = await c.execute("SELECT key, value FROM settings WHERE key LIKE 'lottery_%' ORDER BY key");
console.log('--- AFTER ---');
r.rows.forEach(row => console.log(row.key, '=', row.value));
