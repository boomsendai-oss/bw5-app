import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const tok = (await c.execute("SELECT value FROM settings WHERE key='threads_access_token'")).rows[0]?.value;
const uid = (await c.execute("SELECT value FROM settings WHERE key='threads_user_id'")).rows[0]?.value;
if (!tok || !uid) { console.log('token/uid無し'); process.exit(1); }

const full = (await c.execute("SELECT text FROM threads_posts WHERE id=1")).rows[0].text;

async function tryCreate(label, text) {
  const p = new URLSearchParams({ media_type: 'TEXT', text, access_token: tok });
  const res = await fetch(`https://graph.threads.net/v1.0/${uid}/threads`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString(),
  });
  const j = await res.json();
  console.log(label, res.status, j.id ? `OK container=${j.id}` : JSON.stringify(j.error ?? j).slice(0, 140));
}

await tryCreate('①短文', 'テスト');
await tryCreate('②絵文字入り', 'テストです😊');
await tryCreate('③改行入り', '1行目\n\n2行目');
await tryCreate('④実文面(354字)', full);
await tryCreate('⑤実文面の前半のみ', full.slice(0, 150));
