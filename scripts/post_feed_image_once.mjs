// 単発の画像フィード投稿(共同投稿者・画像タグ付き)。告知など手動で1回だけ出すとき用。
//
// 使い方:
//   node scripts/post_feed_image_once.mjs --image-url https://media.boom-sendai.com/....jpg \
//        --caption-file caption.txt --collaborators "a,b,c" --tags "a:0.5:0.5,b:0.2:0.9" [--dry-run]
//
// --dry-run: コンテナ作成(共同投稿者・タグの指定がIGに受け付けられるか)まで行い、公開はしない
// ⚠️ 画像は JPEG の公開URLであること(IGの仕様で PNG は不可)。
// ⚠️ 共同投稿者は最大3人。相手が承認するまでは相手のプロフィールには出ない。
// トークンは本番Turso settingsから取得(instagram.ts / post_reel_once.mjs と同じ保存場所)。
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = args.includes('--dry-run');
const IMAGE_URL = opt('--image-url');
const CAPTION = opt('--caption-file') ? readFileSync(opt('--caption-file'), 'utf8').trim() : '';
const COLLAB = String(opt('--collaborators') ?? '')
  .split(/[\s,]+/)
  .map((s) => s.replace(/^@+/, '').trim())
  .filter(Boolean)
  .slice(0, 3);
const TAGS = String(opt('--tags') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [username, x, y] = s.split(':');
    return { username: username.replace(/^@+/, ''), x: Number(x), y: Number(y) };
  });
if (!IMAGE_URL) { console.error('--image-url が必要です'); process.exit(1); }
if (!/\.jpe?g($|\?)/i.test(IMAGE_URL)) { console.error('画像は JPEG の URL にしてください'); process.exit(1); }

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

const body = { image_url: IMAGE_URL, caption: CAPTION, access_token: TOKEN };
if (COLLAB.length) body.collaborators = JSON.stringify(COLLAB);
if (TAGS.length) body.user_tags = JSON.stringify(TAGS);

const createRes = await fetch(`${G}/${IG_USER}/media`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body),
});
const createJson = await createRes.json();
if (!createRes.ok || !createJson.id) {
  console.error('コンテナ作成失敗:', JSON.stringify(createJson.error ?? createJson));
  process.exit(1);
}
console.log('コンテナ作成OK(共同投稿者・タグの指定は受け付けられた):', createJson.id);
console.log('  共同投稿者:', COLLAB.join(', ') || '(なし)', '/ タグ:', TAGS.map((t) => t.username).join(', ') || '(なし)');
console.log('  キャプション文字数:', [...CAPTION].length, '/ ハッシュタグ数:', (CAPTION.match(/#/g) || []).length);

if (DRY) { console.log('--dry-run のため公開しません'); process.exit(0); }

// 画像はすぐ FINISHED になることが多いが、念のため状態を見る
for (let i = 0; i < 24; i++) {
  const st = await (await fetch(`${G}/${createJson.id}?fields=status_code&access_token=${encodeURIComponent(TOKEN)}`)).json();
  if (st.status_code === 'FINISHED' || !st.status_code) break;
  if (st.status_code === 'ERROR') { console.error('画像の処理でエラー'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 5000));
}
const pubRes = await fetch(`${G}/${IG_USER}/media_publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ creation_id: createJson.id, access_token: TOKEN }),
});
const pubJson = await pubRes.json();
if (!pubRes.ok || !pubJson.id) {
  // 一時エラーでも実際は公開されていることがある(instagram.ts listRecentMedia の注記)→ 呼び出し側で一覧を確認する
  console.error('公開APIがエラーを返しました(実際は公開済みのことがあるので一覧で確認):', JSON.stringify(pubJson.error ?? pubJson));
  process.exit(2);
}
const pl = await (await fetch(`${G}/${pubJson.id}?fields=permalink&access_token=${encodeURIComponent(TOKEN)}`)).json();
console.log('公開OK:', pubJson.id, pl.permalink ?? '');
