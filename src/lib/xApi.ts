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

/**
 * ツイート1本を投稿してツイートIDを返す。
 * inReplyTo を渡すとそのツイートへのリプライ(=ツリー連結)になる。
 * 失敗は throw (呼び出し側で status='failed' + error 保存)。
 */
export async function postTweet(
  text: string,
  inReplyTo?: string,
  creds: XCredentials = getXCredentials()
): Promise<string> {
  const body: { text: string; reply?: { in_reply_to_tweet_id: string } } = { text };
  if (inReplyTo) body.reply = { in_reply_to_tweet_id: inReplyTo };

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
