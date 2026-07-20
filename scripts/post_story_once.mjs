// 単発ストーリー即時投稿（臨時告知用: 休講・代講・時間変更など）
// 使い方: node scripts/post_story_once.mjs --image-url https://bw5-app.vercel.app/stories/extra/xxx.png
// 朝の定時cronとは独立。トークンは本番settingsから(post_reel_once.mjsと同方式)
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const IMAGE_URL = opt('--image-url');
if (!IMAGE_URL) { console.error('--image-url が必要です'); process.exit(1); }

for (const line of readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^(TURSO_[A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const get = async (k) => (await db.execute({ sql: 'SELECT value FROM settings WHERE key=?', args: [k] })).rows[0]?.value;
const TOKEN = (await get('instagram_access_token'))?.trim();
const IG_USER = (await get('instagram_ig_user_id'))?.trim();
if (!TOKEN || !IG_USER) { console.error('トークン未設定'); process.exit(1); }
const G = 'https://graph.instagram.com/v21.0';

const createRes = await fetch(`${G}/${IG_USER}/media`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ media_type: 'STORIES', image_url: IMAGE_URL, access_token: TOKEN }),
});
const createJson = await createRes.json();
if (!createRes.ok || !createJson.id) { console.error('コンテナ作成失敗:', JSON.stringify(createJson)); process.exit(1); }
console.log('コンテナ作成OK:', createJson.id);

let status = '';
for (let i = 0; i < 24; i++) {
  const st = await (await fetch(`${G}/${createJson.id}?fields=status_code&access_token=${encodeURIComponent(TOKEN)}`)).json();
  status = st.status_code;
  console.log(`  [${i}] status=${status}`);
  if (status === 'FINISHED' || status === 'ERROR') break;
  await new Promise((r) => setTimeout(r, 3000));
}
if (status !== 'FINISHED') { console.error('処理未完了:', status); process.exit(1); }

const pub = await (await fetch(`${G}/${IG_USER}/media_publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ creation_id: createJson.id, access_token: TOKEN }),
})).json();
if (!pub.id) { console.error('公開失敗:', JSON.stringify(pub)); process.exit(1); }
console.log('🎉 ストーリー公開完了 media_id:', pub.id);
