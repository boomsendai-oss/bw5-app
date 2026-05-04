import { createClient } from '@libsql/client';
import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.production.local', 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i+1).trim().replace(/^"|"$/g,'')];
    }));
const c = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const r = await c.execute("SELECT key, value FROM settings WHERE key LIKE '%lottery%' OR key LIKE '%jackpot%' OR key LIKE '%secret%'");
r.rows.forEach(row => console.log(row.key, '=', row.value));
console.log('---');
const w = await c.execute('SELECT COUNT(*) AS c FROM lottery_winners');
console.log('現在の当選者数:', w.rows[0].c);
