#!/usr/bin/env node
// リール動画/カバーを R2 にアップロードして公開URLを出す(2026-09-08 R2移行)。
//
// 使い方:
//   node scripts/upload_reel.mjs <file.mp4|jpg> [<file>...] [--draft <dirName>]
//     省略時:   reels/<basename> に置く(完成リール・カバー用)
//     --draft:  reel-drafts/<dirName>/<basename> に置く(候補タイル・プレビュー用)
//   node scripts/upload_reel.mjs --sync
//     public/reels と public/reel-drafts の全体を差分同期(初回移行・取りこぼし回復用)
//
// 出力: 1行1URL(そのまま reel_queue.video_path / cover_path に入れられる絶対URL)。
// 前提: wrangler が Cloudflare(boom.sendai@gmail.com)にログイン済みで R2 スコープを持つこと。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r2Put, syncDirToR2, manifestPathFor, MEDIA_BASE_URL } from './lib/r2media.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(APP, 'public');

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log('usage: upload_reel.mjs <file>... [--draft <dirName>] | --sync');
  process.exit(args.length === 0 ? 1 : 0);
}

if (args.includes('--sync')) {
  for (const prefix of ['reels', 'reel-drafts']) {
    await syncDirToR2(PUBLIC, prefix, manifestPathFor(APP, prefix));
  }
  console.log(`公開ベースURL: ${MEDIA_BASE_URL}`);
  process.exit(0);
}

let draftDir = null;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--draft') { draftDir = args[++i]; continue; }
  files.push(args[i]);
}
if (draftDir === '' || (draftDir && /[\/\s]/.test(draftDir))) {
  console.error('--draft の名前にスラッシュ/空白は使えません');
  process.exit(1);
}
for (const f of files) {
  const base = path.basename(f);
  if (/[^\x21-\x7e]/.test(base)) {
    // 2026-07-28障害: 日本語ファイル名は Instagram 側のフェッチが落ちる
    console.error(`ファイル名は ASCII のみにしてください: ${base}`);
    process.exit(1);
  }
  const key = draftDir ? `reel-drafts/${draftDir}/${base}` : `reels/${base}`;
  console.log(r2Put(path.resolve(f), key));
}
