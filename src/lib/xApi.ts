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

// ---- 動画アップロード (チャンク方式) ----
// リールを X へ横展開するために使う。画像の simple upload とは別APIが必要。
//
// 採用API: X API v2 チャンクアップロード
//   POST /2/media/upload/initialize      {media_type, total_bytes, media_category}
//   POST /2/media/upload/{id}/append     multipart: media=バイナリ, segment_index=N
//   POST /2/media/upload/{id}/finalize
//   GET  /2/media/upload?media_id={id}   処理完了までポーリング
//   出典: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
//
// ⚠️ 無料枠のレート制限が厳しい: /initialize と /finalize が **24時間で17回**、
//    /append も同じ枠を消費する。1本あたり INIT 1 + APPEND n + FINALIZE 1 なので、
//    5MBチャンクなら20MBの動画で約6回。**1日1〜2本が現実的な上限**。
//    リールは1日1本なので足りるが、リトライを重ねると枯れる点に注意
//    (crosspost.ts の MAX_ATTEMPTS=3 と「1実行1件」はこの制限に合わせている)。

/** APPEND 1回あたりのチャンクサイズ。X の上限は5MBなので少し下げて4MB */
export const X_VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;
/** 動画の上限 512MB / 140秒 (X仕様)。リールは十分収まる */
export const X_VIDEO_MAX_BYTES = 512 * 1024 * 1024;

/** チャンクアップロードの必要リクエスト数を見積もる(レート制限の事前判断用) */
export function estimateChunkRequests(byteLength: number): number {
  return 1 + Math.ceil(byteLength / X_VIDEO_CHUNK_BYTES) + 1; // INIT + APPEND* + FINALIZE
}

/**
 * URLを「署名ベース文字列に使うパス部分」と「クエリパラメータ」に分ける。
 *
 * OAuth 1.0a では
 *   - 署名ベース文字列のURIにクエリを含めてはいけない (RFC 5849 §3.4.1.2)
 *   - クエリパラメータは署名対象のパラメータ集合に入れる (RFC 5849 §3.4.1.3.1)
 * の両方を満たす必要がある。URLをそのまま buildOAuthHeader に渡すとどちらも破るので、
 * クエリ付きのリクエスト(media upload の STATUS)が必ず401になる。
 *
 * 値はデコードして返す。署名側が改めてパーセントエンコードするため、
 * ここで生の値に戻しておかないと二重エンコードになる。
 */
export function splitUrlParams(url: string): {
  baseUrl: string;
  params: Record<string, string>;
} {
  const u = new URL(url);
  const params: Record<string, string> = {};
  for (const [k, v] of u.searchParams) params[k] = v;
  u.search = '';
  return { baseUrl: u.toString(), params };
}

async function xJson(
  method: 'POST' | 'GET',
  url: string,
  creds: XCredentials,
  init?: { json?: unknown; form?: FormData }
): Promise<Record<string, unknown>> {
  // 署名はクエリを外したURL + クエリパラメータで作り、リクエストは元のURLへ送る
  const { baseUrl, params } = splitUrlParams(url);
  const headers: Record<string, string> = {
    Authorization: buildOAuthHeader(method, baseUrl, creds, params),
  };
  let body: BodyInit | undefined;
  if (init?.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init?.form) {
    // multipart は Content-Type を fetch に任せる(boundary付与のため)
    body = init.form;
  }
  const res = await fetch(url, { method, headers, body });
  const raw = await res.text();
  if (!res.ok) throw new Error(`X media ${method} ${res.status}: ${raw.slice(0, 300)}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`X media: 非JSONレスポンス: ${raw.slice(0, 200)}`);
  }
}

/**
 * 動画をチャンクアップロードして media id を返す。ツイートは作らない。
 * 失敗は throw。処理待ちは最大 waitMs までポーリングする。
 */
export async function uploadVideo(
  bytes: Uint8Array,
  creds: XCredentials = getXCredentials(),
  opts?: { waitMs?: number; sleep?: (ms: number) => Promise<void> }
): Promise<string> {
  if (bytes.byteLength === 0) throw new Error('動画データが空です');
  if (bytes.byteLength > X_VIDEO_MAX_BYTES) {
    throw new Error(`動画が512MB上限を超過 (${bytes.byteLength} bytes)`);
  }
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const waitMs = opts?.waitMs ?? 120_000;

  // 1. INITIALIZE
  const init = await xJson('POST', `${MEDIA_UPLOAD_URL}/initialize`, creds, {
    json: {
      media_type: 'video/mp4',
      total_bytes: bytes.byteLength,
      media_category: 'tweet_video',
    },
  });
  const mediaId = String((init.data as { id?: string | number } | undefined)?.id ?? '');
  if (!mediaId) throw new Error(`X media initialize: media idが無い`);

  // 2. APPEND
  let segment = 0;
  for (let off = 0; off < bytes.byteLength; off += X_VIDEO_CHUNK_BYTES) {
    const chunk = bytes.slice(off, off + X_VIDEO_CHUNK_BYTES);
    const form = new FormData();
    form.append('media', new Blob([chunk], { type: 'video/mp4' }), 'chunk');
    form.append('segment_index', String(segment));
    await xJson('POST', `${MEDIA_UPLOAD_URL}/${mediaId}/append`, creds, { form });
    segment++;
  }

  // 3. FINALIZE — 動画は非同期処理に入るので processing_info を見る
  const fin = await xJson('POST', `${MEDIA_UPLOAD_URL}/${mediaId}/finalize`, creds);
  let info = (fin.data as { processing_info?: { state?: string; check_after_secs?: number } })
    ?.processing_info;

  // 4. 処理完了までポーリング
  const deadline = Date.now() + waitMs;
  while (info && info.state !== 'succeeded') {
    if (info.state === 'failed') throw new Error(`X media 処理失敗: ${JSON.stringify(info)}`);
    if (Date.now() >= deadline) throw new Error('X media 処理がタイムアウト');
    await sleep(Math.max(1, info.check_after_secs ?? 5) * 1000);
    // GET /2/media/upload?command=STATUS&media_id=...
    // 出典: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
    // command=STATUS が無いとSTATUSコマンドとして扱われない
    const st = await xJson(
      'GET',
      `${MEDIA_UPLOAD_URL}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      creds
    );
    info = (st.data as { processing_info?: { state?: string; check_after_secs?: number } })
      ?.processing_info;
  }

  return mediaId;
}
