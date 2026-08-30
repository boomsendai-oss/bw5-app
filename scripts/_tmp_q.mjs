import { createClient } from '@libsql/client';
import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.production.local','utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const db=createClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN});
for (const q of process.argv.slice(2)) { for (const r of (await db.execute(q)).rows) console.log('   '+JSON.stringify(r)); }
