// 単発リール投稿スクリプト（ステージリール用・手動/スケジュール実行）
//
// 使い方:
//   node scripts/post_reel_once.mjs --video-url https://bw5-app.vercel.app/reels/xxx.mp4 \
//        --caption-file /path/to/caption.txt [--dry-run]
//
// --dry-run: コンテナ作成(アップロード検証)まで行い、公開はしない
// トークンは本番Turso settingsから取得（instagram.tsと同じ保存場所）
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = args.includes('--dry-run');
const VIDEO_URL = opt('--video-url');
const COVER_URL = opt('--cover-url');
const CAPTION = opt('--caption-file') ? readFileSync(opt('--caption-file'), 'utf8').trim() : '';
if (!VIDEO_URL) { console.error('--video-url が必要です'); process.exit(1); }

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

// 1) コンテナ作成
const createRes = await fetch(`${G}/${IG_USER}/media`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    media_type: 'REELS',
    video_url: VIDEO_URL,
    caption: CAPTION,
    share_to_feed: 'true',
    ...(COVER_URL ? { cover_url: COVER_URL } : {}),
    access_token: TOKEN,
  }),
});
const createJson = await createRes.json();
if (!createRes.ok || !createJson.id) {
  console.error('コンテナ作成失敗:', JSON.stringify(createJson));
  process.exit(1);
}
const containerId = createJson.id;
console.log('コンテナ作成OK:', containerId);

// 2) 処理完了までポーリング（最大5分）
let status = '';
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await (await fetch(`${G}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(TOKEN)}`)).json();
  status = st.status_code;
  console.log(`  [${i}] status=${status}`);
  if (status === 'FINISHED' || status === 'ERROR') break;
}
if (status !== 'FINISHED') { console.error('動画処理が完了しませんでした:', status); process.exit(1); }

if (DRY) { console.log('DRY RUN: 検証OK・公開はしていません'); process.exit(0); }

// 3) 公開
const pubRes = await fetch(`${G}/${IG_USER}/media_publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ creation_id: containerId, access_token: TOKEN }),
});
const pubJson = await pubRes.json();
if (!pubRes.ok || !pubJson.id) { console.error('公開失敗:', JSON.stringify(pubJson)); process.exit(1); }
console.log('🎉 リール公開完了 media_id:', pubJson.id);
console.log(`permalink確認: ${G}/${pubJson.id}?fields=permalink&access_token=...`);
