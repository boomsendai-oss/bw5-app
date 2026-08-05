// src/lib/tiktok.ts — Node.js runtime 専用。
//
// リールのTikTok横展開(TARO 2026-08-05)。
//
// ⚠️ **審査(Audit)を通すまで、投稿は全部「自分だけ」の公開範囲に落ちる**のがTikTokの仕様。
//    未審査クライアントの投稿は privacy_level_options に SELF_ONLY しか返らない。
//    このライブラリは creator_info が返した選択肢の中から
//    PUBLIC_TO_EVERYONE があればそれを、無ければ SELF_ONLY を使う。
//    審査が通れば**コード変更なしで自動的に公開投稿へ切り替わる**。
//
//   - OAuth認可: https://www.tiktok.com/v2/auth/authorize/
//   - トークン:   POST https://open.tiktokapis.com/v2/oauth/token/
//   - creator情報: POST /v2/post/publish/creator_info/query/
//   - 投稿開始:    POST /v2/post/publish/video/init/
//   - 状態確認:    POST /v2/post/publish/status/fetch/
//
// アップロード方式は **FILE_UPLOAD**(バイト列をPUT)を使う。
// PULL_FROM_URL のほうが軽いが、**ドメイン所有者確認が必須**で
// bw5-app.vercel.app の検証をTikTok側で通す手間がかかる。
// BOOMのリールは18〜55MBで、TikTokの1チャンク上限(64MB)に収まるので単一チャンクで送れる。
//
// トークンは**24時間で失効**する(Instagram/Facebookの60日とは全く違う)。
// refresh_token(365日)を保存し、使う直前に毎回リフレッシュする。
//
// 前提(TAROの一度きりの手動セットアップ):
//   1. TikTok for Developers でアプリ登録、Content Posting API 製品を追加
//   2. Direct Post を有効化、リダイレクトURI
//      https://bw5-app.vercel.app/api/staff/tiktok/callback を登録
//   3. env に TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET を設定(Vercel環境変数)
//   4. /staff/instagram の「TikTokを連携する」で同意(一度きり)
//   5. 公開投稿にするには**審査を申請して通す**(それまではSELF_ONLYで溜まる)

import { getOne, execute } from './db';

const ACCESS_TOKEN_KEY = 'tiktok_access_token';
const REFRESH_TOKEN_KEY = 'tiktok_refresh_token';
const OPEN_ID_KEY = 'tiktok_open_id';
const ISSUED_AT_KEY = 'tiktok_token_issued_at';

const API = 'https://open.tiktokapis.com/v2';
const SCOPES = ['video.publish'];

/** 投稿完了を待つ上限 */
const PUBLISH_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;

function getEnv() {
  return { clientKey: process.env.TIKTOK_CLIENT_KEY, clientSecret: process.env.TIKTOK_CLIENT_SECRET };
}

export function configured(): boolean {
  const { clientKey, clientSecret } = getEnv();
  return !!(clientKey && clientSecret);
}

function requireEnv() {
  const { clientKey, clientSecret } = getEnv();
  if (!clientKey || !clientSecret) throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET が未設定です');
  return { clientKey, clientSecret };
}

export function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/staff/tiktok/callback`;
}

/** 連携(同意)用URL。TikTokは state 必須 */
export function buildConsentUrl(origin: string, state: string): string {
  const { clientKey } = requireEnv();
  const params = new URLSearchParams({
    client_key: clientKey,
    scope: SCOPES.join(','),
    response_type: 'code',
    redirect_uri: getRedirectUri(origin),
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

async function getSetting(key: string): Promise<string | undefined> {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [key]);
  return (row?.value as string | undefined) || undefined;
}

async function storeTokens(json: Record<string, unknown>): Promise<string> {
  const access = String(json.access_token ?? '');
  const refresh = String(json.refresh_token ?? '');
  if (!access) throw new Error(`アクセストークンが取得できませんでした: ${JSON.stringify(json)}`);
  await Promise.all([
    upsertSetting(ACCESS_TOKEN_KEY, access),
    ...(refresh ? [upsertSetting(REFRESH_TOKEN_KEY, refresh)] : []),
    ...(json.open_id ? [upsertSetting(OPEN_ID_KEY, String(json.open_id))] : []),
    upsertSetting(ISSUED_AT_KEY, new Date().toISOString()),
  ]);
  return access;
}

/** 同意後のcodeをトークンに交換して保存する */
export async function exchangeAndStoreToken(code: string, origin: string): Promise<{ openId: string }> {
  const { clientKey, clientSecret } = requireEnv();
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: decodeURIComponent(code),
      grant_type: 'authorization_code',
      redirect_uri: getRedirectUri(origin),
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`トークン取得失敗: ${JSON.stringify(json)}`);
  await storeTokens(json);
  return { openId: String(json.open_id ?? '') };
}

/**
 * 使う直前に必ず呼ぶ。TikTokのアクセストークンは24時間で切れるので、
 * 「古くなったら更新」ではなく**毎回リフレッシュ**する方が確実で安い。
 */
async function freshAccessToken(): Promise<string> {
  const { clientKey, clientSecret } = requireEnv();
  const refresh = await getSetting(REFRESH_TOKEN_KEY);
  if (!refresh) {
    throw new Error('TikTok未連携です。/staff/instagram の「TikTokを連携する」から連携してください');
  }
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`トークン更新失敗: ${JSON.stringify(json)}`);
  return storeTokens(json);
}

export async function connectionStatus(): Promise<{
  tiktokConnected: boolean;
  tiktokOpenId?: string;
  tiktokTokenIssuedAt?: string;
}> {
  const [refresh, openId, issuedAt] = await Promise.all([
    getSetting(REFRESH_TOKEN_KEY),
    getSetting(OPEN_ID_KEY),
    getSetting(ISSUED_AT_KEY),
  ]);
  if (!refresh) return { tiktokConnected: false };
  return { tiktokConnected: true, tiktokOpenId: openId, tiktokTokenIssuedAt: issuedAt };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 動画をTikTokへ投稿する。
 *
 * @param bytes 動画のバイト列(FILE_UPLOAD方式。1チャンクで送る)
 * @param title 本文(ハッシュタグ・メンション可・2200文字まで)
 * @returns publish_id と、審査状況によって決まった実際の公開範囲
 */
export async function postVideo(
  bytes: Uint8Array,
  title: string
): Promise<{ publishId: string; privacyLevel: string; permalink: string }> {
  const token = await freshAccessToken();
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=UTF-8',
  };

  // 1. 使える公開範囲を訊く。**未審査のうちは SELF_ONLY しか返らない**ので、
  //    ここで返ってきた選択肢の中から選ぶ(決め打ちするとAPIに弾かれる)。
  const ciRes = await fetch(`${API}/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: authHeaders,
  });
  const ciJson = await ciRes.json();
  if (!ciRes.ok || ciJson.error?.code !== 'ok') {
    throw new Error(`creator_info取得失敗: ${JSON.stringify(ciJson.error ?? ciJson)}`);
  }
  const options: string[] = ciJson.data?.privacy_level_options ?? [];
  const privacyLevel = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY';

  // 2. 投稿を開始。BOOMのリールは最大55MBで、TikTokの1チャンク上限(64MB)に収まる
  const videoSize = bytes.byteLength;
  const initRes = await fetch(`${API}/post/publish/video/init/`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      post_info: { title: title.slice(0, 2200), privacy_level: privacyLevel },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: videoSize,
        total_chunk_count: 1,
      },
    }),
  });
  const initJson = await initRes.json();
  if (!initRes.ok || initJson.error?.code !== 'ok') {
    throw new Error(`投稿開始失敗: ${JSON.stringify(initJson.error ?? initJson)}`);
  }
  const publishId = String(initJson.data?.publish_id ?? '');
  const uploadUrl = String(initJson.data?.upload_url ?? '');
  if (!publishId || !uploadUrl) throw new Error('publish_id / upload_url が取得できませんでした');

  // 3. 動画本体をPUT(単一チャンクなので Content-Range は 0-(size-1)/size)
  const upRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(videoSize),
      'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: bytes as unknown as BodyInit,
  });
  if (!upRes.ok) {
    throw new Error(`動画アップロード失敗 ${upRes.status}: ${(await upRes.text()).slice(0, 200)}`);
  }

  // 4. 完了待ち。TikTokは非同期処理なので、ここを省くと「投稿できたのに実は失敗」を見逃す
  const deadline = Date.now() + PUBLISH_WAIT_MS;
  let status = 'PROCESSING_UPLOAD';
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const stRes = await fetch(`${API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ publish_id: publishId }),
    });
    const stJson = await stRes.json();
    status = String(stJson.data?.status ?? status);
    if (status === 'PUBLISH_COMPLETE') break;
    if (status === 'FAILED') {
      throw new Error(`投稿失敗: ${JSON.stringify(stJson.data?.fail_reason ?? stJson)}`);
    }
  }
  if (status !== 'PUBLISH_COMPLETE') {
    throw new Error(`${PUBLISH_WAIT_MS / 1000}秒以内に完了しませんでした(status=${status})`);
  }

  const openId = await getSetting(OPEN_ID_KEY);
  return {
    publishId,
    privacyLevel,
    // TikTokは投稿IDから直接URLを組めないので、プロフィールを指す
    permalink: openId ? `https://www.tiktok.com/@${openId}` : 'https://www.tiktok.com/',
  };
}
