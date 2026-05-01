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
  sql: "UPDATE sns_links SET url = ? WHERE platform = 'youtube'",
  args: ['https://www.youtube.com/@twp2019'],
});
console.log('youtube link updated:', r.rowsAffected);

const check = await c.execute("SELECT * FROM sns_links WHERE platform = 'youtube'");
console.log(check.rows[0]);
