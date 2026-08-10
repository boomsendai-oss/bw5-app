/**
 * TikTok手動/半自動投稿のための素材出し。
 *
 * TikTokのContent Posting APIは審査で却下された(個人/社内利用はサポート外)。
 * そのためブラウザから投稿するが、キャプションだけは **cronと完全に同じ整形** を
 * 通したい(@ハンドルの無害化を外すと無関係な人に通知が飛ぶ)。
 * ここは src/lib/crosspost.ts の関数をそのまま呼ぶための薄いラッパー。
 *
 * 使い方:
 *   node scripts/tiktok/prepare.mjs            # 直近のIG公開済みリールを1本
 *   node scripts/tiktok/prepare.mjs --reel 12  # reel_queue の id 指定
 *   node scripts/tiktok/prepare.mjs --list     # 候補一覧だけ見る
 *
 * 出力: scripts/tiktok/out/<id>/ に video/cover をコピーし、caption.txt と job.json を書く。
 * Playwright側(post.py)はこの job.json だけを読む。
 */
import { createClient } from '@libsql/client';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, '..', '..');

// .env.local から Turso の接続情報を読む(Next.js を起動せずに使いたいので手で読む)
function loadEnv() {
  const envPath = join(APP_ROOT, '.env.local');
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv();
const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

// crosspost.ts(TS)を jiti でそのまま読む。
// **実装を写経しないこと**: 二重実装すると @ハンドル無害化のルールがいずれ食い違い、
// 無関係な人に通知が飛ぶ事故につながる。常に本体を参照する。
const { createJiti } = await import('jiti');
const jiti = createJiti(import.meta.url);
const { sanitizeHandlesForOtherPlatform, buildTikTokTitle } = await jiti.import(
  join(APP_ROOT, 'src', 'lib', 'crosspost.ts')
);

const args = process.argv.slice(2);
const reelIdArg = args.includes('--reel') ? Number(args[args.indexOf('--reel') + 1]) : null;
const listOnly = args.includes('--list');

const { rows: reels } = await db.execute(
  `SELECT id, title, video_path, cover_path, caption, status, scheduled_at
     FROM reel_queue
    WHERE status = 'posted'
    ORDER BY scheduled_at DESC
    LIMIT 10`
);

if (listOnly) {
  for (const r of reels) console.log(`#${r.id}\t${r.scheduled_at}\t${r.title}`);
  process.exit(0);
}

const reel = reelIdArg ? reels.find((r) => Number(r.id) === reelIdArg) : reels[0];
if (!reel) {
  console.error(reelIdArg ? `reel #${reelIdArg} が見つかりません` : '公開済みリールがありません');
  process.exit(1);
}

const { rows: instructors } = await db.execute(
  'SELECT name, instagram_handle FROM instructors WHERE instagram_handle IS NOT NULL'
);
const nameByHandle = Object.fromEntries(
  instructors
    .filter((r) => r.instagram_handle)
    .map((r) => [String(r.instagram_handle).trim().toLowerCase(), String(r.name).trim()])
);

// cron と同じ2段階: ハンドル無害化 → TikTok用の丸め
const caption = buildTikTokTitle(sanitizeHandlesForOtherPlatform(String(reel.caption), nameByHandle));

const outDir = join(HERE, 'out', String(reel.id));
mkdirSync(outDir, { recursive: true });

function stage(relPath, label) {
  if (!relPath) return null;
  const src = join(APP_ROOT, 'public', String(relPath).replace(/^\//, ''));
  if (!existsSync(src)) throw new Error(`${label} が見つかりません: ${src}`);
  const dst = join(outDir, basename(src));
  copyFileSync(src, dst);
  return dst;
}

const videoPath = stage(reel.video_path, '動画');
const coverPath = stage(reel.cover_path, 'カバー');
if (!coverPath) {
  console.error('⚠️ このリールには cover_path がありません。TikTokはカバーを後から変更できないので、先にカバーを用意すること。');
  process.exit(1);
}

writeFileSync(join(outDir, 'caption.txt'), caption, 'utf8');
writeFileSync(
  join(outDir, 'job.json'),
  JSON.stringify({ reelId: Number(reel.id), title: reel.title, videoPath, coverPath, caption }, null, 2),
  'utf8'
);

console.log(`#${reel.id} ${reel.title}`);
console.log(`  動画  : ${videoPath}`);
console.log(`  カバー: ${coverPath}`);
console.log(`  文字数: ${[...caption].length}`);
console.log(`\njob.json → ${join(outDir, 'job.json')}`);
