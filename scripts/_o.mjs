import { createClient } from '@libsql/client';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.production.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')];}));
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const o = await db.execute('select id, pay_method, payment_status from bf_orders where id=29'); console.log('申込29:', JSON.stringify(o.rows[0]));
const c = await db.execute('select amount, collected_by from bf_cash_collect where order_id=29'); console.log('集金の控え:', JSON.stringify(c.rows[0] ?? null));
const g = await db.execute('select handed, handed_by from bf_gate_entry where order_id=29'); console.log('入場記録:', JSON.stringify(g.rows[0] ?? null));
