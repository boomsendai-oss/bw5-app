import { createClient } from '@libsql/client';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.production.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const r = await db.execute('select * from bf_cash_collect');
console.log('DBに残った記録:', r.rows.map(x=>({...x})));
