// src/lib/instagram.ts — Node.js runtime 専用。
//
// インスタストーリーズ(動画)の自動投稿。Meta Graph API を使う。
// 認証は Facebook Login for Business (OAuth) → 長期ユーザートークンを
// settings('instagram_long_lived_token') に保存、Instagram Business Account ID を
// settings('instagram_ig_user_id') に保存。googleCalendar.ts と同じ settings キー方式。
//
// 前提 (TARO側の一度きりの手動セットアップが必要):
//   1. Meta for Developers でアプリ作成 (種類=Business)
//   2. アプリに「Instagram」プロダクトを追加
//   3. BOOMのFacebookページ ⇄ InstagramビジネスアカウントをMeta Business Suiteで連携済みにする
//   4. env に META_APP_ID / META_APP_SECRET を設定 (Vercel環境変数)
//   5. /api/staff/instagram/connect にアクセスしてOAuth同意 (一度きり)
//
// 未設定の間は configured()=false で全処理をno-op化する (gbp.ts と同じ設計)。

import { getOne, execute } from './db';

const TOKEN_KEY = 'instagram_long_lived_token';
const TOKEN_ISSUED_AT_KEY = 'instagram_token_issued_at';
const IG_USER_ID_KEY = 'instagram_ig_user_id';
const PAGE_ID_KEY = 'instagram_page_id';
const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Facebook Login for Business のスコープ。ページ一覧取得+紐づくIGアカウント取得+投稿。
const SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'];

function getEnv() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  return { appId, appSecret };
}

/** Meta App の env が設定済みか (未設定ならcronは全部no-op) */
export function configured(): boolean {
  const { appId, appSecret } = getEnv();
  return !!(appId && appSecret);
}

function requireEnv() {
  const { appId, appSecret } = getEnv();
  if (!appId || !appSecret) {
    throw new Error('META_APP_ID / META_APP_SECRET が未設定です');
  }
  return { appId, appSecret };
}

export function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/staff/instagram/callback`;
}

/** 連携(同意)用URLを生成 */
export function buildConsentUrl(origin: string): string {
  const { appId } = requireEnv();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getRedirectUri(origin),
    scope: SCOPES.join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Graph API error: ${JSON.stringify(json.error ?? json)}`);
  }
  return json;
}

/**
 * 同意後のcodeを処理:
 *  1. code → 短期ユーザートークン
 *  2. 短期 → 長期ユーザートークン(60日)
 *  3. /me/accounts でページ一覧取得 → BOOMのページを含むFacebookページ管理権限から
 *     instagram_business_account を持つページを探す
 *  4. settingsに保存
 */
export async function exchangeAndStoreToken(code: string, origin: string): Promise<{ igUserId: string; pageId: string }> {
  const { appId, appSecret } = requireEnv();
  const redirectUri = getRedirectUri(origin);

  const shortLived = await fetchJson(
    `${GRAPH_BASE}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
  );
  const shortToken = shortLived.access_token as string;
  if (!shortToken) throw new Error('短期アクセストークンの取得に失敗しました');

  const longLived = await fetchJson(
    `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`
  );
  const longToken = longLived.access_token as string;
  if (!longToken) throw new Error('長期アクセストークンの取得に失敗しました');

  const pages = await fetchJson(`${GRAPH_BASE}/me/accounts?fields=id,name,instagram_business_account&access_token=${longToken}`);
  const withIg = (pages.data ?? []).find((p: any) => p.instagram_business_account?.id);
  if (!withIg) {
    throw new Error('Instagramビジネスアカウントが紐づいたFacebookページが見つかりません。Meta Business SuiteでFacebookページとInstagramアカウントの連携を確認してください');
  }
  const igUserId = withIg.instagram_business_account.id as string;
  const pageId = withIg.id as string;

  await Promise.all([
    upsertSetting(TOKEN_KEY, longToken),
    upsertSetting(TOKEN_ISSUED_AT_KEY, new Date().toISOString()),
    upsertSetting(IG_USER_ID_KEY, igUserId),
    upsertSetting(PAGE_ID_KEY, pageId),
  ]);

  return { igUserId, pageId };
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

export async function isConnected(): Promise<boolean> {
  const tok = await getSetting(TOKEN_KEY);
  const igUserId = await getSetting(IG_USER_ID_KEY);
  return !!(tok && igUserId);
}

export async function connectionStatus(): Promise<{
  connected: boolean;
  igUserId?: string;
  tokenIssuedAt?: string;
  tokenAgeDays?: number;
}> {
  const [tok, igUserId, issuedAt] = await Promise.all([
    getSetting(TOKEN_KEY),
    getSetting(IG_USER_ID_KEY),
    getSetting(TOKEN_ISSUED_AT_KEY),
  ]);
  if (!tok || !igUserId) return { connected: false };
  const tokenAgeDays = issuedAt ? Math.floor((Date.now() - new Date(issuedAt).getTime()) / 86400000) : undefined;
  return { connected: true, igUserId, tokenIssuedAt: issuedAt, tokenAgeDays };
}

/**
 * 長期トークンは60日で失効する。まだ有効なうちに再交換(fb_exchange_token)すると
 * 有効期限がさらに60日延びる。45日を超えたら更新する運用(cron経由で呼ぶ想定)。
 */
export async function refreshTokenIfStale(): Promise<{ refreshed: boolean; ageDays?: number }> {
  const { appId, appSecret } = requireEnv();
  const status = await connectionStatus();
  if (!status.connected) return { refreshed: false };
  if ((status.tokenAgeDays ?? 0) < 45) return { refreshed: false, ageDays: status.tokenAgeDays };

  const currentToken = await getSetting(TOKEN_KEY);
  const refreshed = await fetchJson(
    `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`
  );
  const newToken = refreshed.access_token as string;
  if (!newToken) throw new Error('トークン更新に失敗しました');
  await Promise.all([upsertSetting(TOKEN_KEY, newToken), upsertSetting(TOKEN_ISSUED_AT_KEY, new Date().toISOString())]);
  return { refreshed: true, ageDays: 0 };
}

async function requireConnection(): Promise<{ token: string; igUserId: string }> {
  const token = await getSetting(TOKEN_KEY);
  const igUserId = await getSetting(IG_USER_ID_KEY);
  if (!token || !igUserId) {
    throw new Error('Instagram未連携です。/staff/instagram の「連携する」ボタンから連携してください');
  }
  return { token, igUserId };
}

/**
 * 動画ストーリーズを投稿する。
 *  1. POST /{ig-user-id}/media (video_url, media_type=STORIES) → creation_id
 *  2. コンテナのステータスがFINISHEDになるまでポーリング(動画処理に数秒〜数十秒かかる)
 *  3. POST /{ig-user-id}/media_publish (creation_id) → media_id
 *
 * videoUrl は公開URL必須(Metaサーバーがサーバー側で取得しにいく)。
 */
export async function publishStoryVideo(videoUrl: string): Promise<{ mediaId: string }> {
  const { token, igUserId } = await requireConnection();

  const createRes = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: videoUrl, media_type: 'STORIES', access_token: token }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error) {
    throw new Error(`コンテナ作成失敗: ${JSON.stringify(createJson.error ?? createJson)}`);
  }
  const creationId = createJson.id as string;

  // 動画処理待ち: 最大60秒、3秒間隔でポーリング
  const deadline = Date.now() + 60_000;
  let statusCode = 'IN_PROGRESS';
  while (Date.now() < deadline) {
    const statusJson = await fetchJson(`${GRAPH_BASE}/${creationId}?fields=status_code&access_token=${token}`);
    statusCode = statusJson.status_code;
    if (statusCode === 'FINISHED') break;
    if (statusCode === 'ERROR') throw new Error('動画コンテナの処理でエラーが発生しました');
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (statusCode !== 'FINISHED') {
    throw new Error(`動画処理がタイムアウトしました(status=${statusCode})`);
  }

  const publishRes = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: token }),
  });
  const publishJson = await publishRes.json();
  if (!publishRes.ok || publishJson.error) {
    throw new Error(`公開失敗: ${JSON.stringify(publishJson.error ?? publishJson)}`);
  }
  return { mediaId: publishJson.id as string };
}
