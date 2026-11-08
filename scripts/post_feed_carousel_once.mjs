// 単発の画像カルーセル(横にめくる複数枚)フィード投稿。告知など手動で1回だけ出すとき用。
//
// 使い方:
//   node scripts/post_feed_carousel_once.mjs --image-urls "https://...1.jpg,https://...2.jpg" \
//        --caption-file caption.txt [--collaborators "a,b"] [--dry-run]
//
// --dry-run: 各画像と全体の器(コンテナ)の作成まで行い、公開はしない
// 終了コード: 0=公開OK / 1=作成の失敗(公開されていない=再試行してよい) / 2=公開時の失敗(公開された可能性があるので再試行しない)
// ⚠️ 画像は JPEG の公開URL・2〜10枚。⚠️ 共同投稿者は最大3人。相手が承認するまで相手のプロフィールには出ない。
// トークンは本番Turso settingsから取得(post_feed_image_once.mjs と同じ)。
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = args.includes('--dry-run');
const URLS = String(opt('--image-urls') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const CAPTION = opt('--caption-file') ? readFileSync(opt('--caption-file'), 'utf8').trim() : '';
const COLLAB = String(opt('--collaborators') ?? '')
  .split(/[\s,]+/)
  .map((s) => s.replace(/^@+/, '').trim())
  .filter(Boolean)
  .slice(0, 3);
if (URLS.length < 2 || URLS.length > 10) { console.error('--image-urls は2〜10枚'); process.exit(1); }
if (URLS.some((u) => !/\.jpe?g($|\?)/i.test(u))) { console.error('画像は JPEG の URL にしてください'); process.exit(1); }

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

const post = async (path, body) => {
  const res = await fetch(`${G}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, access_token: TOKEN }),
  });
  return { ok: res.ok, json: await res.json() };
};
const waitFinished = async (id) => {
  for (let i = 0; i < 36; i++) {
    const st = await (await fetch(`${G}/${id}?fields=status_code&access_token=${encodeURIComponent(TOKEN)}`)).json();
    if (st.status_code === 'FINISHED' || !st.status_code) return true;
    if (st.status_code === 'ERROR') return false;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
};

const children = [];
for (const url of URLS) {
  const r = await post(`${IG_USER}/media`, { image_url: url, is_carousel_item: 'true' });
  if (!r.ok || !r.json.id) { console.error('画像の器の作成失敗:', url, JSON.stringify(r.json.error ?? r.json)); process.exit(1); }
  if (!(await waitFinished(r.json.id))) { console.error('画像の処理でエラー:', url); process.exit(1); }
  children.push(r.json.id);
}
const body = { media_type: 'CAROUSEL', children: children.join(','), caption: CAPTION };
if (COLLAB.length) body.collaborators = JSON.stringify(COLLAB);
const parent = await post(`${IG_USER}/media`, body);
if (!parent.ok || !parent.json.id) { console.error('全体の器の作成失敗:', JSON.stringify(parent.json.error ?? parent.json)); process.exit(1); }
console.log('器の作成OK:', parent.json.id, '/ 枚数:', children.length, '/ 共同投稿者:', COLLAB.join(', ') || '(なし)');
console.log('  キャプション文字数:', [...CAPTION].length, '/ ハッシュタグ数:', (CAPTION.match(/#/g) || []).length);
if (DRY) { console.log('--dry-run のため公開しません'); process.exit(0); }
if (!(await waitFinished(parent.json.id))) { console.error('全体の処理でエラー'); process.exit(1); }

const pub = await post(`${IG_USER}/media_publish`, { creation_id: parent.json.id });
if (!pub.ok || !pub.json.id) {
  console.error('公開APIがエラーを返しました(実際は公開済みのことがあるので一覧で確認):', JSON.stringify(pub.json.error ?? pub.json));
  process.exit(2);
}
const pl = await (await fetch(`${G}/${pub.json.id}?fields=permalink&access_token=${encodeURIComponent(TOKEN)}`)).json();
console.log('公開OK:', pub.json.id, pl.permalink ?? '');
