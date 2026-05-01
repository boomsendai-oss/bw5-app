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
  sql: 'UPDATE merchandise SET image_url = ? WHERE id = 7',
  args: ['/merch/tote_lightgrey.png'],
});
console.log('tote thumbnail updated:', r.rowsAffected);

const check = await c.execute('SELECT id, name, image_url FROM merchandise WHERE id = 7');
console.log(check.rows[0]);
