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

const r = await c.execute({
  sql: 'UPDATE merchandise SET name = ? WHERE id = 9',
  args: ['BW5 映像データ販売'],
});
console.log('updated:', r.rowsAffected);

const v = await c.execute('SELECT id, name, price FROM merchandise WHERE id = 9');
console.log(v.rows[0]);
