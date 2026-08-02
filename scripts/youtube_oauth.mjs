#!/usr/bin/env node
// YouTube アップロード用のリフレッシュトークンを取る一回きりの補助スクリプト。
//
//   node scripts/youtube_oauth.mjs
//
// GBPと同じ Google OAuth クライアントを使うが、**スコープが違うので認可し直しが必要**。
// 得たトークンは Vercel env の YOUTUBE_REFRESH_TOKEN に入れる (src/lib/youtube.ts が読む)。
//
// ⚠️ 事前に Google Cloud Console で2つやること:
//   1. YouTube Data API v3 を有効化 (GBPと同じプロジェクトでよい)
//   2. OAuthクライアントの「承認済みのリダイレクト URI」に次を追加
//        http://localhost:8765/callback
//
// ⚠️ 同意画面では **BOOMのYouTubeチャンネルを持つGoogleアカウント** を選ぶこと。
//    別アカウントで取ると、別のチャンネルに動画が上がる。
//    最後にチャンネル名を表示するので、そこで必ず確認する。
//
// パスワード入力とアクセス許可はTARO本人が行う (Claudeは代行しない)。

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const PORT = Number(process.env.OAUTH_PORT ?? 8765);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

function loadEnv() {
  // Vercel から落とした .env.production.local を読む (無ければ環境変数)
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
    // ファイルが無いのは正常 (環境変数で渡す場合)
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? fromFile.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? fromFile.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET が見つかりません。\n' +
        'bw5-app のルートで `vercel env pull .env.production.local` を実行してから再実行してください。'
    );
    process.exit(1);
  }
  return { clientId, clientSecret };
}

/** ブラウザのリダイレクトを1回だけ受けて認可コードを取る */
function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<html><body style="font-family:sans-serif;padding:40px">
         <h2>${code ? '認可できました' : '認可に失敗しました'}</h2>
         <p>${code ? 'ターミナルに戻ってください。' : error ?? ''}</p>
         </body></html>`
      );
      server.close();
      if (code) resolve(code);
      else reject(new Error(`認可エラー: ${error ?? '不明'}`));
    });
    server.on('error', reject);
    server.listen(PORT);
  });
}

async function exchangeCode(code, clientId, clientSecret) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`トークン交換に失敗 ${res.status}: ${raw.slice(0, 400)}`);
  return JSON.parse(raw);
}

/** どのチャンネルを認可したのかを表示する (アカウント取り違えの検出) */
async function showChannel(accessToken) {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const raw = await res.text();
  if (!res.ok) {
    console.log(`\n⚠️ チャンネル確認に失敗 ${res.status}: ${raw.slice(0, 300)}`);
    console.log('   → YouTube Data API v3 が有効化されていない可能性があります。');
    return;
  }
  const items = JSON.parse(raw).items ?? [];
  if (items.length === 0) {
    console.log('\n⚠️ このアカウントにYouTubeチャンネルがありません。別のアカウントで取り直してください。');
    return;
  }
  for (const it of items) {
    console.log(`\n✅ 認可したチャンネル: ${it.snippet?.title}  (id: ${it.id})`);
  }
  console.log('   ↑ BOOMのチャンネルであることを必ず確認してください。違ったら取り直しです。');
}

const { clientId, clientSecret } = loadEnv();

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    // refresh_token は初回同意時にしか返らない。再認可でも確実に受け取るため両方指定する
    access_type: 'offline',
    prompt: 'consent',
  });

console.log('─'.repeat(70));
console.log('次のURLをブラウザで開き、**BOOMのYouTubeチャンネルのアカウント**で許可してください:\n');
console.log(authUrl);
console.log('\n' + '─'.repeat(70));
console.log(`ブラウザからの戻りを ${REDIRECT_URI} で待っています... (Ctrl+C で中止)`);
console.log('※「リダイレクトURIが一致しません」と出たら、Google Cloud Console の');
console.log(`  OAuthクライアントに ${REDIRECT_URI} を追加してから再実行してください。\n`);

let code;
try {
  code = await waitForCode();
} catch (e) {
  console.error(`\nローカルサーバで受け取れませんでした: ${e.message}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  code = (await rl.question('ブラウザのURLに含まれる code= の値を貼り付けてください: ')).trim();
  rl.close();
}

const token = await exchangeCode(code, clientId, clientSecret);
if (!token.refresh_token) {
  console.error(
    '\n⚠️ refresh_token が返りませんでした。\n' +
      '   https://myaccount.google.com/permissions で該当アプリのアクセス権を削除してから、もう一度実行してください。'
  );
  process.exit(1);
}

await showChannel(token.access_token);

console.log('\n' + '─'.repeat(70));
console.log('YOUTUBE_REFRESH_TOKEN として次の値を Vercel に設定してください:\n');
console.log(token.refresh_token);
console.log('\nコマンドで入れる場合 (値の入力を求められます):');
console.log('  vercel env add YOUTUBE_REFRESH_TOKEN production');
console.log('─'.repeat(70));
