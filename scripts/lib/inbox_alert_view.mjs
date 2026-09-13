// 受信箱アラートの判定結果を人が読む形にするための共通部品
// (scripts/inbox_alert_review.mjs = 画面に一覧 / scripts/inbox_alert_report.mjs = Markdownに書き出し)。
// DBは読むだけ。件名・差出人はここでは保存せず、呼び出し側に返すだけにする。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LABEL = { boom: 'BOOM', nitroash: 'NITRO ASH', taro: '個人' };
export const ACCOUNTS = Object.keys(LABEL);
export const KIND = {
  new_inquiry: '【新規】', reply: '【返信】', money_deadline: '【期限あり】',
  automation_failure: '【失敗】', money_later: '【お金】', other: '【要確認】',
};
// Opus 5 の料金(1Mトークンあたり・Anthropic公式料金表 2026-06-24時点)と換算レート。
// 記録したトークン数はキャッシュの読み書きも同じ単価で数えているので、金額は概算
export const PRICE_IN = 5;
export const PRICE_OUT = 25;
export const YEN_PER_USD = 150;

const LOCAL_CRED_DIR = { boom: '.gmail-mcp', nitroash: '.gmail-mcp-nitroash' };
/** 件名を取り直すためだけのローカルの鍵置き場(リポジトリの外・0600で保存する) */
export const ALERT_LOCAL_DIR = join(homedir(), '.gmail-alert-local');
export const TARO_TOKEN_PATH = join(ALERT_LOCAL_DIR, 'taro.json');
/** 個人アカウントのログインに使い回すOAuthクライアント(BOOMのもの) */
export const BOOM_KEYS_PATH = join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json');

/** OAuthクライアントのIDとシークレットを JSON から読む(中身はエラー文に入れない) */
export function readOauthClient(path = BOOM_KEYS_PATH) {
  const keys = JSON.parse(readFileSync(path, 'utf8'));
  const c = keys.installed ?? keys.web;
  if (!c?.client_id || !c?.client_secret) {
    throw new Error(`OAuthクライアントの JSON に client_id と client_secret がありません（${path}）`);
  }
  return { id: c.client_id, secret: c.client_secret };
}

/** このMacにあるこのアカウントの鍵。個人は --login-taro で保存した鍵を使う(クライアントはBOOMのもの) */
function localCredentials(account) {
  if (account === 'taro') {
    const cred = JSON.parse(readFileSync(TARO_TOKEN_PATH, 'utf8'));
    return { client: readOauthClient(), refreshToken: cred.refresh_token };
  }
  const dir = LOCAL_CRED_DIR[account];
  if (!dir) return null;
  const client = readOauthClient(join(homedir(), dir, 'gcp-oauth.keys.json'));
  const cred = JSON.parse(readFileSync(join(homedir(), dir, 'credentials.json'), 'utf8'));
  return { client, refreshToken: cred.refresh_token };
}

/** このMacの既存の鍵でGmailのアクセストークンを取る。読めない時は理由も返す(鍵が無い/認証できない) */
export async function localToken(account) {
  let cred;
  try {
    cred = localCredentials(account);
  } catch (e) {
    if (account === 'taro') {
      return { token: null, reason: '(このMacにこのアカウントの鍵がありません: --login-taro で保存できます)' };
    }
    return { token: null, reason: `(このMacの鍵で認証できません: ${e.message})` };
  }
  if (!cred) return { token: null, reason: '(このMacにこのアカウントの鍵がありません)' };
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cred.client.id,
        client_secret: cred.client.secret,
        refresh_token: cred.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await r.json();
    return json.access_token
      ? { token: json.access_token, reason: null }
      : { token: null, reason: `(このMacの鍵で認証できません: ${json.error ?? r.status})` };
  } catch (e) {
    return { token: null, reason: `(このMacの鍵で認証できません: ${e.message})` };
  }
}

/** 1通の件名と差出人をGmailから取り直す。取れない時は理由を返し、呼び出し側は次の行に進む */
export async function fetchSubjectFrom(token, messageId) {
  let r;
  try {
    r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
  } catch (e) {
    // 1件の通信エラーで全体を止めない
    return { ok: false, reason: `(取得失敗: 通信エラー ${e.message})` };
  }
  if (!r.ok) return { ok: false, reason: `(取得失敗 ${r.status})` };
  const m = await r.json().catch(() => ({}));
  const h = Object.fromEntries((m.payload?.headers ?? []).map((x) => [x.name.toLowerCase(), x.value]));
  return { ok: true, subject: h.subject ?? '(件名なし)', from: h.from ?? '' };
}

/**
 * 差出人は表示名だけ出す。表示名が無い(またはアドレスそのもの)ならドメインだけ(お客さんのアドレスをそのまま出さない)。
 * ドメインは山括弧の中の本当のアドレスから取る(表示名に書かれた偽のアドレスに惑わされない)
 */
export function senderLabel(fromHeader) {
  const raw = (fromHeader ?? '').trim();
  const angle = raw.match(/<([^<>]*)>$/);
  const name = (angle ? raw.slice(0, angle.index) : raw.includes('@') ? '' : raw).replace(/"/g, '').trim();
  if (name && !name.includes('@')) return name;
  const address = angle ? angle[1] : raw;
  const domain = address.match(/@([^>\s,;"]+)/)?.[1];
  return domain ? `(${domain})` : '';
}

/** 差出人のドメイン(山括弧の中の本当のアドレスから)。分からなければ (不明) */
export function senderDomain(fromHeader) {
  const raw = (fromHeader ?? '').trim();
  const angle = raw.match(/<([^<>]*)>$/);
  const address = angle ? angle[1] : raw;
  const domain = address.match(/@([^>\s,;"]+)/)?.[1];
  return domain ? domain.toLowerCase().replace(/[.>]+$/, '') : '(不明)';
}

/** トークン数から概算の円(入力・出力で単価が違う) */
export function yenFor(inTokens, outTokens) {
  return Math.round(((inTokens * PRICE_IN + outTokens * PRICE_OUT) / 1_000_000) * YEN_PER_USD);
}

/** 同時に limit 件までだけ走らせて、順番どおりの結果を返す */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
