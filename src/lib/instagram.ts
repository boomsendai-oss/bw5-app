// src/lib/instagram.ts — Node.js runtime 専用。
//
// インスタストーリーズ(動画)の自動投稿。
// **Instagram API with Instagram Login** 方式を使う(Facebookページ不要・直接Instagramに繋ぐ)。
//   - OAuth認可: https://www.instagram.com/oauth/authorize (Instagram App ID)
//   - 短期トークン交換: POST https://api.instagram.com/oauth/access_token
//   - 長期トークン(60日): GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token
//   - 更新: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
//   - 投稿: graph.instagram.com/{ig-user-id}/media (media_type=STORIES) → media_publish
//
// 認証情報は settings テーブルに保存(googleCalendar.ts と同じ方式):
//   instagram_access_token / instagram_token_issued_at / instagram_ig_user_id
//
// 前提(TAROの一度きりの手動セットアップ):
//   1. Meta for Developers でアプリ作成 + Instagram製品追加(済: App ID 1039461798599574)
//   2. Instagramログイン設定でリダイレクトURI登録(済)
//   3. env に INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET を設定(Vercel環境変数)
//   4. BOOMのInstagramを**プロアカウント(ビジネス/クリエイター)**にしておく(投稿APIの必須要件)
//   5. /staff/instagram の「連携する」でOAuth同意(一度きり)
//
// 未設定の間は configured()=false で全処理をno-op化する。

import { getOne, execute } from './db';

const TOKEN_KEY = 'instagram_access_token';
const TOKEN_ISSUED_AT_KEY = 'instagram_token_issued_at';
const IG_USER_ID_KEY = 'instagram_ig_user_id';
const GRAPH = 'https://graph.instagram.com';
const GRAPH_VERSION = 'v21.0';

// Instagramログインで投稿+インサイト取得に必要なスコープ
// manage_insights = リーチ/プロフィールアクセス/フォロワー属性/ストーリー成績の取得用
// (追加後は再認可が必要。旧トークンのままだとインサイトAPIは403)
const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
];

function getEnv() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  return { appId, appSecret };
}

/** env が設定済みか (未設定ならcronは全部no-op) */
export function configured(): boolean {
  const { appId, appSecret } = getEnv();
  return !!(appId && appSecret);
}

function requireEnv() {
  const { appId, appSecret } = getEnv();
  if (!appId || !appSecret) {
    throw new Error('INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET が未設定です');
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
    response_type: 'code',
    scope: SCOPES.join(','),
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
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

/**
 * 同意後のcodeを処理:
 *  1. code → 短期トークン(+ user_id)   POST api.instagram.com/oauth/access_token
 *  2. 短期 → 長期トークン(60日)          GET graph.instagram.com/access_token?grant_type=ig_exchange_token
 *  3. settingsに保存
 */
export async function exchangeAndStoreToken(code: string, origin: string): Promise<{ igUserId: string }> {
  const { appId, appSecret } = requireEnv();

  // 1. 短期トークン (form-urlencoded)
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: getRedirectUri(origin),
    code: code.replace(/#_$/, ''), // Instagramは末尾に "#_" を付けることがある
  });
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const shortJson = await shortRes.json();
  if (!shortRes.ok || shortJson.error_type || shortJson.error) {
    throw new Error(`短期トークン取得失敗: ${JSON.stringify(shortJson)}`);
  }
  const shortToken = shortJson.access_token as string;
  // user_id は data 配列 or トップレベルで返る(APIバージョン差異に両対応)
  const igUserId = String(shortJson.user_id ?? shortJson.data?.[0]?.user_id ?? '');
  if (!shortToken) throw new Error('短期アクセストークンが取得できませんでした');

  // 2. 長期トークン(60日)
  const longRes = await fetch(
    `${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${shortToken}`
  );
  const longJson = await longRes.json();
  if (!longRes.ok || longJson.error) {
    throw new Error(`長期トークン取得失敗: ${JSON.stringify(longJson.error ?? longJson)}`);
  }
  const longToken = longJson.access_token as string;
  if (!longToken) throw new Error('長期アクセストークンが取得できませんでした');

  // user_id が空なら /me で補完
  let finalUserId = igUserId;
  if (!finalUserId) {
    const meRes = await fetch(`${GRAPH}/me?fields=user_id&access_token=${longToken}`);
    const meJson = await meRes.json();
    finalUserId = String(meJson.user_id ?? meJson.id ?? '');
  }

  await Promise.all([
    upsertSetting(TOKEN_KEY, longToken),
    upsertSetting(TOKEN_ISSUED_AT_KEY, new Date().toISOString()),
    upsertSetting(IG_USER_ID_KEY, finalUserId),
  ]);

  return { igUserId: finalUserId };
}

export async function isConnected(): Promise<boolean> {
  const tok = await getSetting(TOKEN_KEY);
  return !!tok;
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
  if (!tok) return { connected: false };
  const tokenAgeDays = issuedAt ? Math.floor((Date.now() - new Date(issuedAt).getTime()) / 86400000) : undefined;
  return { connected: true, igUserId, tokenIssuedAt: issuedAt, tokenAgeDays };
}

/**
 * 長期トークンは60日で失効。まだ有効なうち(発行から24時間以上経過が更新の必須条件)に
 * refresh_access_token で延長する。45日を超えたら更新する運用(cron経由で呼ぶ)。
 */
export async function refreshTokenIfStale(): Promise<{ refreshed: boolean; ageDays?: number }> {
  const status = await connectionStatus();
  if (!status.connected) return { refreshed: false };
  if ((status.tokenAgeDays ?? 0) < 45) return { refreshed: false, ageDays: status.tokenAgeDays };

  const currentToken = await getSetting(TOKEN_KEY);
  const res = await fetch(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`トークン更新失敗: ${JSON.stringify(json.error ?? json)}`);
  const newToken = json.access_token as string;
  if (!newToken) throw new Error('更新後トークンが取得できませんでした');
  await Promise.all([upsertSetting(TOKEN_KEY, newToken), upsertSetting(TOKEN_ISSUED_AT_KEY, new Date().toISOString())]);
  return { refreshed: true, ageDays: 0 };
}

async function requireConnection(): Promise<{ token: string; igUserId: string }> {
  const token = await getSetting(TOKEN_KEY);
  const igUserId = (await getSetting(IG_USER_ID_KEY)) || 'me';
  if (!token) {
    throw new Error('Instagram未連携です。/staff/instagram の「連携する」ボタンから連携してください');
  }
  return { token, igUserId };
}

/**
 * ストーリーズを投稿する(動画/画像共通)。
 *  1. POST /{ig-user-id}/media (video_url|image_url, media_type=STORIES) → creation_id
 *  2. コンテナのstatus_codeがFINISHEDになるまでポーリング(動画処理に数秒〜数十秒。画像はほぼ即時)
 *  3. POST /{ig-user-id}/media_publish (creation_id) → media id
 *
 * mediaUrl は公開URL必須(Metaサーバーがサーバー側で取得しにいく)。
 */
export type PublishStoryResult = {
  mediaId: string;
  mentionsApplied: string[];
  mentionsFailed: string[];
};

/** STORIESコンテナを1つ作成し creation_id を返す(失敗は throw)。指定メンションを user_tags で載せる。 */
async function createStoryContainer(
  base: string,
  token: string,
  mediaUrl: string,
  mediaType: 'video' | 'image',
  mentions: string[]
): Promise<string> {
  const payload: Record<string, unknown> = { media_type: 'STORIES', access_token: token };
  if (mediaType === 'video') payload.video_url = mediaUrl;
  else payload.image_url = mediaUrl;
  if (mentions.length > 0) payload.user_tags = mentions.map((username) => ({ username }));

  const createRes = await fetch(`${base}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error) {
    throw new Error(`コンテナ作成失敗: ${JSON.stringify(createJson.error ?? createJson)}`);
  }
  return createJson.id as string;
}

async function publishStory(
  mediaUrl: string,
  mediaType: 'video' | 'image',
  mentionUsernames?: string[]
): Promise<PublishStoryResult> {
  const { token, igUserId } = await requireConnection();
  const base = `${GRAPH}/${GRAPH_VERSION}/${igUserId}`;
  const requested = (mentionUsernames ?? []).filter((m) => typeof m === 'string' && m.length > 0);

  // ストーリーへのメンション(user_tags)。載せられなかったハンドルで投稿全体を落とさない:
  //   まず全件で試し、コンテナ作成が失敗したら1件ずつ足して「載せられる最大の部分集合」を求める。
  //   これで「不正/非公開ハンドル1件」でも「STORIESのタグ数上限」でも、正当なタグは最大限残し、
  //   落ちたハンドルは mentionsFailed として記録する(無言で全捨てにしない)。
  let creationId: string | null = null;
  let applied: string[] = [];
  const failed: string[] = [];

  try {
    creationId = await createStoryContainer(base, token, mediaUrl, mediaType, requested);
    applied = requested;
  } catch (e) {
    if (requested.length === 0) throw e; // メンション無しでも失敗=本当の障害
    for (const m of requested) {
      try {
        creationId = await createStoryContainer(base, token, mediaUrl, mediaType, [...applied, m]);
        applied.push(m);
      } catch {
        failed.push(m);
      }
    }
    if (creationId === null) {
      // 単独メンションも全滅→メンション無しで最終試行(ここで失敗すれば本当の障害としてthrow)
      creationId = await createStoryContainer(base, token, mediaUrl, mediaType, []);
      applied = [];
    }
  }

  // 動画処理待ち: 最大60秒、3秒間隔でポーリング(画像はほぼ即時FINISHED)
  const deadline = Date.now() + 60_000;
  let statusCode = 'IN_PROGRESS';
  while (Date.now() < deadline) {
    const sres = await fetch(`${GRAPH}/${GRAPH_VERSION}/${creationId}?fields=status_code&access_token=${token}`);
    const sjson = await sres.json();
    if (sjson.error) throw new Error(`コンテナ状態取得失敗: ${JSON.stringify(sjson.error)}`);
    statusCode = sjson.status_code;
    if (statusCode === 'FINISHED') break;
    if (statusCode === 'ERROR') throw new Error('動画コンテナの処理でエラーが発生しました');
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (statusCode !== 'FINISHED') {
    throw new Error(`動画処理がタイムアウトしました(status=${statusCode})`);
  }

  const pubRes = await fetch(`${base}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: token }),
  });
  const pubJson = await pubRes.json();
  if (!pubRes.ok || pubJson.error) {
    throw new Error(`公開失敗: ${JSON.stringify(pubJson.error ?? pubJson)}`);
  }
  return { mediaId: pubJson.id as string, mentionsApplied: applied, mentionsFailed: failed };
}

export async function publishStoryVideo(videoUrl: string, mentions?: string[]): Promise<PublishStoryResult> {
  return publishStory(videoUrl, 'video', mentions);
}

export async function publishStoryImage(imageUrl: string, mentions?: string[]): Promise<PublishStoryResult> {
  return publishStory(imageUrl, 'image', mentions);
}

/**
 * リール公開 (media_type=REELS)。
 *  1. POST /{ig-user-id}/media (video_url, caption, cover_url, share_to_feed)
 *  2. status_code=FINISHED までポーリング(リールはストーリーより処理が長いので最大4分)
 *  3. media_publish → permalink取得
 * 実証済みフロー: scripts/post_reel_once.mjs (2026-07-17 初投稿で検証)
 */
export async function publishReel(
  videoUrl: string,
  caption: string,
  coverUrl?: string
): Promise<{ mediaId: string; permalink?: string }> {
  const { token, igUserId } = await requireConnection();
  const base = `${GRAPH}/${GRAPH_VERSION}/${igUserId}`;

  const payload: Record<string, unknown> = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: 'true',
    access_token: token,
  };
  if (coverUrl) payload.cover_url = coverUrl;

  const createRes = await fetch(`${base}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error) {
    throw new Error(`リールコンテナ作成失敗: ${JSON.stringify(createJson.error ?? createJson)}`);
  }
  const creationId = createJson.id as string;

  const deadline = Date.now() + 240_000;
  let statusCode = 'IN_PROGRESS';
  while (Date.now() < deadline) {
    const sres = await fetch(`${GRAPH}/${GRAPH_VERSION}/${creationId}?fields=status_code&access_token=${token}`);
    const sjson = await sres.json();
    if (sjson.error) throw new Error(`リールコンテナ状態取得失敗: ${JSON.stringify(sjson.error)}`);
    statusCode = sjson.status_code;
    if (statusCode === 'FINISHED') break;
    if (statusCode === 'ERROR') throw new Error('リール動画の処理でエラーが発生しました');
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (statusCode !== 'FINISHED') {
    throw new Error(`リール動画処理がタイムアウトしました(status=${statusCode})`);
  }

  const pubRes = await fetch(`${base}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: token }),
  });
  const pubJson = await pubRes.json();
  if (!pubRes.ok || pubJson.error) {
    throw new Error(`リール公開失敗: ${JSON.stringify(pubJson.error ?? pubJson)}`);
  }
  const mediaId = pubJson.id as string;

  let permalink: string | undefined;
  try {
    const pres = await fetch(`${GRAPH}/${GRAPH_VERSION}/${mediaId}?fields=permalink&access_token=${token}`);
    const pjson = await pres.json();
    if (!pjson.error) permalink = pjson.permalink as string;
  } catch {
    // permalinkは表示用なので失敗しても公開自体は成功扱い
  }
  return { mediaId, permalink };
}
