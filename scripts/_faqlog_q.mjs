import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(process.env.HOME + '/.config/boom/faqbot-log.env', 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const c = createClient({ url: env.FAQBOT_LOG_DB_URL, authToken: env.FAQBOT_LOG_DB_TOKEN });
const sql = process.argv[2];
const r = await c.execute(sql);
console.log(JSON.stringify(r.rows, null, 1));
