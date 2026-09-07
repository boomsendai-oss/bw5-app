// リール/下書きメディアの置き場 = Cloudflare R2 (2026-09-08 移行)。
//
// 背景: public/reels(1.6GB・139本) と public/reel-drafts(139MB) を git 管理+Vercelデプロイに
// 含めていたため、動画を1本足すたびに本番デプロイが走り、Vercel Hobby の
// Deployment Storage 10GB を使い切った(2026-09-08 07:18 Vercelから100%到達メール)。
// 動画は R2 バケット `boom-reels` に置き、公開URL(MEDIA_BASE_URL)で Meta/Threads/TikTok に渡す。
//
// キー構成(バケット内):  reels/<file>.mp4|jpg   reel-drafts/<driveId|stage_N>/<file>
// 公開URL:               ${MEDIA_BASE_URL}/reels/<file> など(=ローカル public/ の相対パスと同形)
//
// アップロードは wrangler(OAuthログイン済み) の `r2 object put` を使う。S3 APIキーを別途
// 発行しなくて済む(=TAROのダッシュボード操作が不要)。
// このモジュールは bw5-app の scripts と、Mac常駐の reel_pipeline.mjs の両方から import される。
// **実装を2か所に写経しないこと**(Content-Type や キー命名がズレると Meta のフェッチが落ちる)。

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

export const BUCKET = process.env.R2_MEDIA_BUCKET || 'boom-reels';
export const MEDIA_BASE_URL = (process.env.MEDIA_BASE_URL || 'https://media.boom-sendai.com').replace(/\/$/, '');

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** 公開URL。`/reels/x.mp4` でも `reels/x.mp4` でも受ける。既に http なら素通し。 */
export function publicUrl(key) {
  const k = String(key);
  if (/^https?:\/\//.test(k)) return k;
  return `${MEDIA_BASE_URL}/${k.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
}

let _wranglerBin = null;
function wranglerBin() {
  if (_wranglerBin) return _wranglerBin;
  _wranglerBin = findWranglerBin();
  return _wranglerBin;
}
function findWranglerBin() {
  // launchd(PATH=/opt/homebrew/bin:...)からも動くよう、グローバル install を優先し無ければ npx
  const cands = ['/opt/homebrew/bin/wrangler', '/usr/local/bin/wrangler'];
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf8' }).trim();
    if (prefix) cands.push(path.join(prefix, 'bin', 'wrangler'));
  } catch { /* npm 無し */ }
  for (const p of cands) {
    if (fs.existsSync(p)) return [p];
  }
  return ['npx', '--yes', 'wrangler'];
}

/**
 * 1ファイルを R2 に置く。key はバケット内キー(先頭スラッシュ無し)。
 * カバー画像はアプリ選択で同名のまま焼き直されるので、長い max-age は付けない。
 */
function putArgs(localPath, key, cacheControl) {
  const k = String(key).replace(/^\/+/, '');
  const [bin, ...pre] = wranglerBin();
  return {
    bin,
    args: [...pre, 'r2', 'object', 'put', `${BUCKET}/${k}`, '--file', localPath,
      '--content-type', contentTypeFor(localPath), '--cache-control', cacheControl, '--remote'],
    key: k,
  };
}
export function r2Put(localPath, key, { cacheControl = 'public, max-age=300' } = {}) {
  const { bin, args, key: k } = putArgs(localPath, key, cacheControl);
  execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  return publicUrl(k);
}
const execFileP = promisify(execFile);
/** r2Put の非同期版(一括同期で並列に走らせる用) */
export async function r2PutAsync(localPath, key, { cacheControl = 'public, max-age=300' } = {}) {
  const { bin, args, key: k } = putArgs(localPath, key, cacheControl);
  await execFileP(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return publicUrl(k);
}

/** 差分同期の台帳(manifest)の置き場。bw5-app/data/ は git 管理外。 */
export function manifestPathFor(appRoot, prefix) {
  return path.join(appRoot, 'data', 'r2', `${prefix}.manifest.json`);
}

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, base, out);
    else if (ent.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * ローカルの publicRoot/<prefix>/ 配下を R2 の <prefix>/ に差分アップロードする。
 * 差分判定は manifest(JSON: key → {size, mtimeMs}) との比較。以前 git status で
 * 「変わったファイルだけ commit」していたのと同じ役割。
 * 戻り値: アップロードしたキーの配列。
 */
export async function syncDirToR2(publicRoot, prefix, manifestPath, { concurrency = 4, log = console.log } = {}) {
  const root = path.join(publicRoot, prefix);
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* 初回 */ }
  const todo = [];
  for (const rel of walk(root)) {
    const local = path.join(root, rel);
    const st = fs.statSync(local);
    const key = `${prefix}/${rel.split(path.sep).join('/')}`;
    const prev = manifest[key];
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;
    todo.push({ local, key, size: st.size, mtimeMs: st.mtimeMs });
  }
  if (todo.length === 0) return [];
  log(`[r2] ${prefix}: ${todo.length} 件をアップロード`);
  const done = [];
  let idx = 0;
  const worker = async () => {
    while (idx < todo.length) {
      const t = todo[idx++];
      try {
        await r2PutAsync(t.local, t.key);
        manifest[t.key] = { size: t.size, mtimeMs: t.mtimeMs };
        done.push(t.key);
        // 途中で死んでも進捗が残るよう都度書く
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      } catch (e) {
        log(`[r2] 失敗 ${t.key}: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  log(`[r2] 完了 ${done.length}/${todo.length}`);
  return done;
}
