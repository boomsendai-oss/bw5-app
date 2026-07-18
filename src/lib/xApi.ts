// X API v2 投稿クライアント (2026-07-17)。
// OAuth 1.0a user context の HMAC-SHA1 署名を Node標準crypto で自前実装する
// (外部ライブラリ依存を増やさない方針。既知ベクタ検証は __tests__/xApi.test.ts)。
//
// 環境変数 (4つ全て揃うまでは xConfigured()=false で cron は dormant を返す):
//   X_API_KEY / X_API_SECRET     … Consumer Keys (developer.x.com のアプリ)
//   X_ACCESS_TOKEN / X_ACCESS_SECRET … 投稿アカウントの Access Token & Secret
import { createHmac, randomBytes } from 'node:crypto';

export type XCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
};

export function xConfigured(): boolean {
  return !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_SECRET
  );
}

export function getXCredentials(): XCredentials {
  return {
    apiKey: process.env.X_API_KEY ?? '',
    apiSecret: process.env.X_API_SECRET ?? '',
    accessToken: process.env.X_ACCESS_TOKEN ?? '',
    accessSecret: process.env.X_ACCESS_SECRET ?? '',
  };
}

/** RFC 3986 percent-encode (OAuth 1.0a仕様。encodeURIComponentが素通しする !'()* も符号化) */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * 署名ベース文字列: METHOD&encode(url)&encode(sorted params)。
 * params には oauthパラメータ + クエリ/フォームパラメータを渡す。
 * JSONボディのリクエスト(X API v2)ではボディは署名対象に含めない。
 */
export function buildSignatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>
): string {
  const pairs = Object.entries(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : 1));
  const paramStr = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramStr)}`;
}

/** HMAC-SHA1 署名 (base64)。signing key = encode(consumerSecret)&encode(tokenSecret) */
export function signHmacSha1(baseString: string, consumerSecret: string, tokenSecret: string): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac('sha1', key).update(baseString).digest('base64');
}

/**
 * Authorization ヘッダを組み立てる。
 * extraParams はフォーム/クエリパラメータ(署名対象・ヘッダには含めない)。
 * opts.nonce / opts.timestamp はテスト用の固定値注入。
 */
export function buildOAuthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  extraParams: Record<string, string> = {},
  opts?: { nonce?: string; timestamp?: string }
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: opts?.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: opts?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const base = buildSignatureBaseString(method, url, { ...oauthParams, ...extraParams });
  const signature = signHmacSha1(base, creds.apiSecret, creds.accessSecret);
  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  const inner = Object.keys(headerParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`)
    .join(', ');
  return `OAuth ${inner}`;
}

const TWEETS_URL = 'https://api.x.com/2/tweets';
const MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload';

/** 添付画像の上限 5MB (docs.x.com/x-api/media/introduction: "Image: 5 MB") */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** 許可する画像MIMEタイプ */
export const MEDIA_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/**
 * 画像1枚をXへアップロードして media id (文字列) を返す。ツイートは作らない。
 *
 * 採用API: X API v2 simple upload — POST https://api.x.com/2/media/upload
 *   出典: https://docs.x.com/x-api/media/upload-media (multipart/form-data、
 *         フィールド media=バイナリ(必須) / media_category / media_type、
 *         OAuth 1.0a user context 可、レスポンス data.id が media id)
 *   チャンク版(INIT/APPEND/FINALIZE)もあるが5MB以下の画像は simple で足りる:
 *   https://docs.x.com/x-api/media/quickstart/media-upload-chunked
 *
 * OAuth 1.0a 署名: multipart/form-data ボディは署名対象パラメータに含めない
 * (OAuth 1.0a仕様 — application/x-www-form-urlencoded 以外のボディは署名に入れない)。
 * よって buildOAuthHeader には extraParams を渡さず oauth_* のみで署名する。
 *
 * 失敗は throw (呼び出し側で status='failed' + error 保存)。
 * アップロード済みメディアは未使用なら expires_after_secs (約24h) で自然失効する。
 */
export async function uploadMedia(
  bytes: Buffer | Uint8Array,
  mimeType: string,
  creds: XCredentials = getXCredentials()
): Promise<string> {
  if (!(MEDIA_ALLOWED_MIME as readonly string[]).includes(mimeType)) {
    throw new Error(`未対応の画像形式: ${mimeType} (許可: ${MEDIA_ALLOWED_MIME.join(', ')})`);
  }
  if (bytes.byteLength === 0) throw new Error('画像データが空です');
  if (bytes.byteLength > MEDIA_MAX_BYTES) {
    throw new Error(`画像が5MB上限を超過 (${bytes.byteLength} bytes)`);
  }

  // Buffer はプールされたオフセット付きビューの場合があるため、新しい ArrayBuffer に
  // コピーして Blob 化する (new Uint8Array(view) はデータコピー。5MB以下なので許容)
  const u8 = new Uint8Array(bytes);
  const form = new FormData();
  form.append('media', new Blob([u8], { type: mimeType }), 'media');
  form.append('media_category', 'tweet_image');
  form.append('media_type', mimeType);

  const res = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    // Content-Type は fetch が boundary 付きで自動設定する(手動指定しない)
    headers: { Authorization: buildOAuthHeader('POST', MEDIA_UPLOAD_URL, creds) },
    body: form,
  });

  const raw = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* 非JSONレスポンスは raw のまま扱う */
  }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : raw;
    throw new Error(`X media upload ${res.status}: ${detail.slice(0, 300)}`);
  }
  const id = (json as { data?: { id?: string | number } } | null)?.data?.id;
  if (!id) {
    throw new Error(`X media upload: レスポンスにmedia idが無い: ${raw.slice(0, 200)}`);
  }
  return String(id);
}

/**
 * ツイート1本を投稿してツイートIDを返す。
 * inReplyTo を渡すとそのツイートへのリプライ(=ツリー連結)になる。
 * mediaIds を渡すと画像添付 (uploadMedia で取得した media id、最大4つ)。
 * 失敗は throw (呼び出し側で status='failed' + error 保存)。
 */
export async function postTweet(
  text: string,
  inReplyTo?: string,
  creds: XCredentials = getXCredentials(),
  mediaIds?: string[]
): Promise<string> {
  const body: {
    text: string;
    reply?: { in_reply_to_tweet_id: string };
    media?: { media_ids: string[] };
  } = { text };
  if (inReplyTo) body.reply = { in_reply_to_tweet_id: inReplyTo };
  if (mediaIds && mediaIds.length > 0) body.media = { media_ids: mediaIds };

  const res = await fetch(TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: buildOAuthHeader('POST', TWEETS_URL, creds),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* 非JSONレスポンスは raw のまま扱う */
  }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : raw;
    throw new Error(`X API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const id = (json as { data?: { id?: string } } | null)?.data?.id;
  if (!id) {
    throw new Error(`X API: レスポンスにツイートIDが無い: ${raw.slice(0, 200)}`);
  }
  return id;
}
