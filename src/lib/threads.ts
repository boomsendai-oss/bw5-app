// src/lib/threads.ts — Node.js runtime 専用。
//
// リールのThreads横展開(TARO 2026-08-05「やれることは全部やる」)。
//
// **Threads API は Instagram とは別物**。同じMetaアプリに製品として足せるが、
// 認可サーバもトークンもGraphのホストも別で、Instagramのトークンは一切使えない。
//   - OAuth認可: https://threads.net/oauth/authorize (Threads App ID)
//   - 短期トークン交換: POST https://graph.threads.net/oauth/access_token
//   - 長期トークン(60日): GET https://graph.threads.net/access_token?grant_type=th_exchange_token
//   - 更新:              GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token
//   - 投稿: {user-id}/threads (media_type=VIDEO, video_url=…) → {user-id}/threads_publish
//
// 投稿の要点:
//   - 動画は**公開URLをThreads側が取りに来る**方式(バイト列を送らない)。
//     BOOMのリールは https://bw5-app.vercel.app/reels/*.mp4 で公開済みなのでそのまま渡せる。
//   - コンテナ作成 → 処理待ち → publish の2段階。作成直後にpublishすると失敗するので
//     ステータスを見ながら待つ(公式の目安は約30秒)。
//   - 上限は24時間で250投稿。BOOMの運用(週2〜3本)では当たらない。
//   - 動画仕様: MP4/MOV・1GB以下・300秒以内・9:16推奨。リールは12〜65秒なので余裕。
//
// 認証情報は settings テーブルに保存(instagram.ts と同じ方式):
//   threads_access_token / threads_token_issued_at / threads_user_id
//
// 前提(TAROの一度きりの手動セットアップ):
//   1. BOOMのThreadsアカウントを用意し、**プロアカウント**にしておく
//   2. Meta for Developers の既存アプリに「Threads API」製品を追加
//   3. リダイレクトURI  https://bw5-app.vercel.app/api/staff/threads/callback  を登録
//   4. env に THREADS_APP_ID / THREADS_APP_SECRET を設定(Vercel環境変数)
//   5. /staff/instagram の「Threadsを連携する」でOAuth同意(一度きり)
//
// 未設定の間は configured()=false のままで、cronは Threads を skipped にして触らない。

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getOne, execute } from './db';

const TOKEN_KEY = 'threads_access_token';
const TOKEN_ISSUED_AT_KEY = 'threads_token_issued_at';
const USER_ID_KEY = 'threads_user_id';
const GRAPH = 'https://graph.threads.net';

// threads_basic は全エンドポイントで必須、threads_content_publish が投稿用。
// 自分のアカウントへ投稿するだけなら Advanced Access の審査は不要。
const SCOPES = ['threads_basic', 'threads_content_publish'];

/** コンテナが処理されるのを待つ上限。公式の目安は約30秒 */
const PUBLISH_WAIT_MS = 90_000;
const POLL_INTERVAL_MS = 5_000;

function getEnv() {
  return { appId: process.env.THREADS_APP_ID, appSecret: process.env.THREADS_APP_SECRET };
}

/**
 * env が設定済みか (未設定ならcronは Threads を触らない)。
 * ⚠️ appSecret は要求しない: シークレットが要るのは初回OAuth(code→トークン交換)だけで、
 * 投稿(postText)もトークン更新(refresh_access_token)も保存済みトークンのみで動く。
 * 両方必須にしていたため、シークレットを持たない環境では稼働できる状態なのに
 * dormant のまま止まっていた (2026-08-21修正)。再連携が必要になったら requireEnv() が明示的に落ちる。
 */
export function configured(): boolean {
  const { appId } = getEnv();
  return !!appId;
}

function requireEnv() {
  const { appId, appSecret } = getEnv();
  if (!appId || !appSecret) throw new Error('THREADS_APP_ID / THREADS_APP_SECRET が未設定です');
  return { appId, appSecret };
}

export function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/staff/threads/callback`;
}

/** 連携(同意)用URL。stateはコールバック側でhttpOnly cookieと照合する(instagram.tsと同型) */
export function buildConsentUrl(origin: string, state?: string): string {
  const { appId } = requireEnv();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getRedirectUri(origin),
    response_type: 'code',
    scope: SCOPES.join(','),
    ...(state ? { state } : {}),
  });
  return `https://threads.net/oauth/authorize?${params.toString()}`;
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
 *  1. code → 短期トークン(+ user_id)  POST graph.threads.net/oauth/access_token
 *  2. 短期 → 長期トークン(60日)        GET  graph.threads.net/access_token?grant_type=th_exchange_token
 *  3. settingsに保存
 */
export async function exchangeAndStoreToken(code: string, origin: string): Promise<{ userId: string }> {
  const { appId, appSecret } = requireEnv();

  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: getRedirectUri(origin),
    code: code.replace(/#_$/, ''), // Metaは末尾に "#_" を付けることがある
  });
  const shortRes = await fetch(`${GRAPH}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const shortJson = await shortRes.json();
  if (!shortRes.ok || shortJson.error_type || shortJson.error) {
    throw new Error(`短期トークン取得失敗: ${JSON.stringify(shortJson)}`);
  }
  const shortToken = shortJson.access_token as string;
  if (!shortToken) throw new Error('短期アクセストークンが取得できませんでした');
  // ⚠️ shortJson.user_id は**絶対に使わない**。ThreadsのユーザーIDは
  // JSONの数値として返るが 2^53 を超えるため、JSON.parse の時点で丸められる
  // (実際に ...101 が ...100 になり、投稿APIが「そんなIDは無い」で落ちた)。
  // 文字列で返る /me の id を必ず使う。

  const longRes = await fetch(
    `${GRAPH}/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${shortToken}`
  );
  const longJson = await longRes.json();
  if (!longRes.ok || longJson.error) {
    throw new Error(`長期トークン取得失敗: ${JSON.stringify(longJson.error ?? longJson)}`);
  }
  const longToken = longJson.access_token as string;
  if (!longToken) throw new Error('長期アクセストークンが取得できませんでした');

  const meRes = await fetch(`${GRAPH}/v1.0/me?fields=id,username&access_token=${longToken}`);
  const meJson = await meRes.json();
  const userId = String(meJson.id ?? '');
  if (!userId) throw new Error(`ユーザーIDが取得できませんでした: ${JSON.stringify(meJson)}`);

  await Promise.all([
    upsertSetting(TOKEN_KEY, longToken),
    upsertSetting(TOKEN_ISSUED_AT_KEY, new Date().toISOString()),
    upsertSetting(USER_ID_KEY, userId),
  ]);
  return { userId };
}

/**
 * Metaが送ってくる signed_request を検証して中身を返す。
 *
 * 形式は `<base64url署名>.<base64urlペイロード>` で、署名はペイロード文字列を
 * app secret でHMAC-SHA256したもの。**検証せずに中身を信じると、誰でも
 * 「連携解除された」と偽装して連携を壊せる**ので必ず通す。
 * 検証に失敗したら null を返す。
 */
export function parseSignedRequest(signed: string): Record<string, unknown> | null {
  const { appSecret } = getEnv();
  if (!appSecret) return null;
  const [sigPart, payloadPart] = String(signed).split('.');
  if (!sigPart || !payloadPart) return null;
  const expected = createHmac('sha256', appSecret).update(payloadPart).digest();
  const actual = Buffer.from(sigPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** 連携情報を消す(利用者がThreads側でアプリの許可を取り消したとき) */
export async function clearConnection(): Promise<void> {
  await execute('DELETE FROM settings WHERE key IN (?, ?, ?)', [
    TOKEN_KEY,
    TOKEN_ISSUED_AT_KEY,
    USER_ID_KEY,
  ]);
}

export async function connectionStatus(): Promise<{
  threadsConnected: boolean;
  threadsUserId?: string;
  threadsTokenIssuedAt?: string;
  threadsTokenAgeDays?: number;
}> {
  const [tok, userId, issuedAt] = await Promise.all([
    getSetting(TOKEN_KEY),
    getSetting(USER_ID_KEY),
    getSetting(TOKEN_ISSUED_AT_KEY),
  ]);
  if (!tok) return { threadsConnected: false };
  const ageDays = issuedAt
    ? Math.floor((Date.now() - new Date(issuedAt).getTime()) / 86400000)
    : undefined;
  return {
    threadsConnected: true,
    threadsUserId: userId,
    threadsTokenIssuedAt: issuedAt,
    threadsTokenAgeDays: ageDays,
  };
}

/**
 * 長期トークンは60日で失効。45日を超えたら更新する(instagram.tsと同じ運用)。
 * 更新には発行から24時間以上の経過が必要なので、連携直後に呼んでも何もしない。
 */
export async function refreshTokenIfStale(): Promise<{ refreshed: boolean; ageDays?: number }> {
  const status = await connectionStatus();
  if (!status.threadsConnected) return { refreshed: false };
  if ((status.threadsTokenAgeDays ?? 0) < 45) {
    return { refreshed: false, ageDays: status.threadsTokenAgeDays };
  }
  const currentToken = await getSetting(TOKEN_KEY);
  const res = await fetch(
    `${GRAPH}/refresh_access_token?grant_type=th_refresh_token&access_token=${currentToken}`
  );
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`トークン更新失敗: ${JSON.stringify(json.error ?? json)}`);
  const newToken = json.access_token as string;
  if (!newToken) throw new Error('更新後トークンが取得できませんでした');
  await Promise.all([
    upsertSetting(TOKEN_KEY, newToken),
    upsertSetting(TOKEN_ISSUED_AT_KEY, new Date().toISOString()),
  ]);
  return { refreshed: true, ageDays: 0 };
}

async function requireConnection(): Promise<{ token: string; userId: string }> {
  const token = await getSetting(TOKEN_KEY);
  const userId = await getSetting(USER_ID_KEY);
  if (!token || !userId) {
    throw new Error('Threads未連携です。/staff/instagram の「Threadsを連携する」から連携してください');
  }
  return { token, userId };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 動画をThreadsへ投稿する。
 *
 * @param videoUrl 公開URL。Threadsのサーバがここに取りに来るので、認証をかけてはいけない
 * @param text     本文(Instagram向けの@ハンドルは crosspost.ts 側で無害化済みのものを渡す)
 * @returns 投稿ID(パーマリンクの組み立てに使う)
 */
export async function postVideo(videoUrl: string, text: string): Promise<{ id: string; permalink: string }> {
  const { token, userId } = await requireConnection();

  // 1. コンテナ作成(この時点ではまだ公開されない)
  const createParams = new URLSearchParams({
    media_type: 'VIDEO',
    video_url: videoUrl,
    text,
    access_token: token,
  });
  const createRes = await fetch(`${GRAPH}/v1.0/${userId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createParams.toString(),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error) {
    throw new Error(`コンテナ作成失敗: ${JSON.stringify(createJson.error ?? createJson)}`);
  }
  const creationId = String(createJson.id ?? '');
  if (!creationId) throw new Error('creation_id が取得できませんでした');

  // 2. 動画の処理待ち。ERROR を検出したら理由付きで即座に失敗させる
  //    (待ち切ってからpublishして失敗するより、原因が分かるほうが直しやすい)
  const deadline = Date.now() + PUBLISH_WAIT_MS;
  let lastStatus = 'UNKNOWN';
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const stRes = await fetch(
      `${GRAPH}/v1.0/${creationId}?fields=status,error_message&access_token=${token}`
    );
    const stJson = await stRes.json();
    lastStatus = String(stJson.status ?? 'UNKNOWN');
    if (lastStatus === 'FINISHED') break;
    if (lastStatus === 'ERROR' || lastStatus === 'EXPIRED') {
      throw new Error(`動画の処理に失敗(${lastStatus}): ${stJson.error_message ?? '理由不明'}`);
    }
  }
  if (lastStatus !== 'FINISHED') {
    throw new Error(`動画の処理が${PUBLISH_WAIT_MS / 1000}秒以内に終わりませんでした(status=${lastStatus})`);
  }

  // 3. 公開
  const pubParams = new URLSearchParams({ creation_id: creationId, access_token: token });
  const pubRes = await fetch(`${GRAPH}/v1.0/${userId}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pubParams.toString(),
  });
  const pubJson = await pubRes.json();
  if (!pubRes.ok || pubJson.error) {
    throw new Error(`公開失敗: ${JSON.stringify(pubJson.error ?? pubJson)}`);
  }
  const id = String(pubJson.id ?? '');
  if (!id) throw new Error('投稿IDが取得できませんでした');

  // permalink は別途取得できるが、失敗しても投稿自体は成功しているので握りつぶす
  let permalink = `https://www.threads.net/@_/post/${id}`;
  try {
    const pRes = await fetch(`${GRAPH}/v1.0/${id}?fields=permalink&access_token=${token}`);
    const pJson = await pRes.json();
    if (pJson.permalink) permalink = String(pJson.permalink);
  } catch {
    // permalinkが取れなくても投稿は完了している
  }
  return { id, permalink };
}

/**
 * テキスト投稿(SNSテキスト配信レーン 2026-08-06)。
 * TEXTコンテナは動画と違い通常すぐ公開できるので、長いポーリングはせず
 * publish失敗時のみ短く待って再試行する(固定投稿をAPIで作った実績のある方式)。
 */
/**
 * 投稿を削除する (Threads API: DELETE /v1.0/{threads-media-id})。
 * 自動投稿の誤りを撤回して出し直すために使う(2026-09-05)。消えていれば成功扱い。
 */
export async function deletePost(mediaId: string): Promise<void> {
  const { token } = await requireConnection();
  const res = await fetch(`${GRAPH}/v1.0/${encodeURIComponent(mediaId)}?access_token=${token}`, { method: 'DELETE' });
  if (res.ok) return;
  const body = await res.text();
  if (res.status === 404) return;
  throw new Error(`Threads削除失敗 HTTP ${res.status}: ${body.slice(0, 300)}`);
}

export async function postText(text: string): Promise<{ id: string; permalink: string }> {
  const { token, userId } = await requireConnection();

  const createParams = new URLSearchParams({ media_type: 'TEXT', text, access_token: token });
  const createRes = await fetch(`${GRAPH}/v1.0/${userId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: createParams.toString(),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || createJson.error) {
    throw new Error(`コンテナ作成失敗: ${JSON.stringify(createJson.error ?? createJson)}`);
  }
  const creationId = String(createJson.id ?? '');
  if (!creationId) throw new Error('creation_id が取得できませんでした');

  const pubParams = new URLSearchParams({ creation_id: creationId, access_token: token });
  let lastErr: unknown = null;
  let id = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(3000);
    const pubRes = await fetch(`${GRAPH}/v1.0/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: pubParams.toString(),
    });
    const pubJson = await pubRes.json();
    if (pubRes.ok && !pubJson.error && pubJson.id) {
      id = String(pubJson.id);
      break;
    }
    lastErr = pubJson.error ?? pubJson;
  }
  if (!id) throw new Error(`公開失敗: ${JSON.stringify(lastErr)}`);

  let permalink = `https://www.threads.net/@_/post/${id}`;
  try {
    const pRes = await fetch(`${GRAPH}/v1.0/${id}?fields=permalink&access_token=${token}`);
    const pJson = await pRes.json();
    if (pJson.permalink) permalink = String(pJson.permalink);
  } catch {
    // permalinkが取れなくても投稿は完了している
  }
  return { id, permalink };
}
