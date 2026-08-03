#!/usr/bin/env node
// 既にアップロード済みのYouTube動画の公開設定を変える。
//
//   YOUTUBE_REFRESH_TOKEN=xxx node scripts/youtube_set_privacy.mjs <videoId> <public|unlisted|private>
//
// env の YOUTUBE_PRIVACY_STATUS は**これから上がる動画**にしか効かないので、
// 既に上がっている分を切り替えるにはAPIを直接叩く必要がある。
// (限定公開で確認 → 問題なければ公開、という運用の後半をやる道具)
//
// 採用API: YouTube Data API v3 videos.update (part=status)
//   videos.update は**指定したpartを丸ごと置き換える**ので、
//   先に videos.list で現在の status を取り、privacyStatus だけ差し替えて送る。
//   そうしないと selfDeclaredMadeForKids 等が意図せず消える。
//
// クォータ: videos.list 1 unit + videos.update 50 units (1日10,000)。
//
// ⚠️ **必要なスコープ**: videos.update は `https://www.googleapis.com/auth/youtube` または
//    `youtube.force-ssl` を要求する。投稿用の `youtube.upload` だけでは 403
//    "Request had insufficient authentication scopes." になる(2026-08-03に実地で確認)。
//    自動投稿(youtube.ts)は upload だけで足りるので、既定のトークンはこの操作には使えない。
//    使う場合は youtube_oauth.mjs の SCOPE に youtube.force-ssl を足して取り直すこと。

import { readFileSync } from 'node:fs';

const [videoId, privacy] = process.argv.slice(2);
const ALLOWED = ['public', 'unlisted', 'private'];
if (!videoId || !ALLOWED.includes(privacy)) {
  console.error(
    'usage: YOUTUBE_REFRESH_TOKEN=xxx node scripts/youtube_set_privacy.mjs <videoId> <public|unlisted|private>'
  );
  process.exit(1);
}

function loadEnv() {
  let fromFile = {};
  try {
    fromFile = Object.fromEntries(
      readFileSync('.env.production.local', 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
        })
    );
  } catch {
    // ファイルが無いのは正常(環境変数で渡す場合)
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || fromFile.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || fromFile.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || fromFile.YOUTUBE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.error(
      'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN が必要です。\n' +
        'トークンはVercelから読めないので、YOUTUBE_REFRESH_TOKEN=... を前置きして実行してください。'
    );
    process.exit(1);
  }
  return { clientId, clientSecret, refreshToken };
}

const { clientId, clientSecret, refreshToken } = loadEnv();

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }),
});
const tokenRaw = await tokenRes.text();
if (!tokenRes.ok) throw new Error(`token取得失敗 ${tokenRes.status}: ${tokenRaw.slice(0, 300)}`);
const accessToken = JSON.parse(tokenRaw).access_token;

const auth = { Authorization: `Bearer ${accessToken}` };

// 現在の状態を取る(取り違え防止のためタイトルとチャンネル名も出す)
const listRes = await fetch(
  `https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${encodeURIComponent(videoId)}`,
  { headers: auth }
);
const listRaw = await listRes.text();
if (!listRes.ok) throw new Error(`videos.list失敗 ${listRes.status}: ${listRaw.slice(0, 300)}`);
const item = (JSON.parse(listRaw).items ?? [])[0];
if (!item) throw new Error(`動画が見つかりません(または権限がありません): ${videoId}`);

console.log(`対象: ${item.snippet.title}`);
console.log(`チャンネル: ${item.snippet.channelTitle}`);
console.log(`変更前: ${item.status.privacyStatus} → 変更後: ${privacy}`);

if (item.status.privacyStatus === privacy) {
  console.log('すでにその設定です。何もしませんでした。');
  process.exit(0);
}

// status を丸ごと送り直す(privacyStatusだけ差し替え)
const updateRes = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', {
  method: 'PUT',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: videoId, status: { ...item.status, privacyStatus: privacy } }),
});
const updateRaw = await updateRes.text();
if (!updateRes.ok) throw new Error(`videos.update失敗 ${updateRes.status}: ${updateRaw.slice(0, 300)}`);

console.log(`✅ 完了: ${JSON.parse(updateRaw).status.privacyStatus}`);
console.log(`https://www.youtube.com/shorts/${videoId}`);
