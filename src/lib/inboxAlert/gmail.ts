// 受信箱アラート: Gmail API(読み取り専用)の薄いラッパーと、本文抽出・返信判定(純関数)。
// 本文(body.data)はGmail APIが元の文字コードに関係なくUTF-8に変換して返す(2026-09-11 実データ365日分で確認)。
import type { GmailClient } from './accounts';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** 通信が固まってもVercelの60秒上限で黙って落ちず、エラーとして数えられるようにする */
const TIMEOUT_MS = 15_000;
type FetchLike = typeof fetch;

/** 鍵が失効・取り消しされた(Googleへの再ログインが必要) */
export class GmailAuthError extends Error {}

/** メールやスレッドが見つからない(削除済みなど) */
export class GmailNotFoundError extends Error {}

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};

export type MessageRef = { id: string; threadId: string };

export async function getAccessToken(client: GmailClient, refreshToken: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (json.error === 'invalid_grant') throw new GmailAuthError('invalid_grant');
  if (!res.ok || !json.access_token) throw new Error(`token ${res.status} ${json.error ?? ''}`.trim());
  return json.access_token;
}

async function gmailGet<T>(token: string, path: string, fetchImpl: FetchLike): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new GmailAuthError('unauthorized');
  if (res.status === 404) throw new GmailNotFoundError(`gmail 404 ${path.split('?')[0]}`);
  if (!res.ok) throw new Error(`gmail ${res.status} ${path.split('?')[0]}`);
  return (await res.json()) as T;
}

export async function getProfileEmail(token: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const p = await gmailGet<{ emailAddress: string }>(token, '/profile', fetchImpl);
  return p.emailAddress;
}

/** after(秒)以降に届いたメールを全ページ取る(新しい順)。送信済み・チャットは除く。迷惑メール/ゴミ箱はAPI既定で除外 */
export async function listMessageRefsSince(token: string, afterSec: number, fetchImpl: FetchLike = fetch): Promise<MessageRef[]> {
  const q = encodeURIComponent(`after:${afterSec} -in:sent -in:chats`);
  const out: MessageRef[] = [];
  let pageToken = '';
  do {
    const page = await gmailGet<{ messages?: MessageRef[]; nextPageToken?: string }>(
      token,
      `/messages?maxResults=500&q=${q}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      fetchImpl,
    );
    out.push(...(page.messages ?? []));
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

const META_HEADERS = ['From', 'Subject', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted'];

export async function getMessageMeta(token: string, id: string, fetchImpl: FetchLike = fetch): Promise<GmailMessage> {
  const hs = META_HEADERS.map((h) => `&metadataHeaders=${h}`).join('');
  return gmailGet<GmailMessage>(token, `/messages/${id}?format=metadata${hs}`, fetchImpl);
}

export async function getMessageFull(token: string, id: string, fetchImpl: FetchLike = fetch): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(token, `/messages/${id}?format=full`, fetchImpl);
}

/** スレッドのメッセージ一覧。スレッドが消えていれば null */
export async function getThreadMessages(token: string, threadId: string, fetchImpl: FetchLike = fetch): Promise<GmailMessage[] | null> {
  try {
    const t = await gmailGet<{ messages?: GmailMessage[] }>(token, `/threads/${threadId}?format=minimal`, fetchImpl);
    return t.messages ?? [];
  } catch (e) {
    if (e instanceof GmailNotFoundError) return null;
    throw e;
  }
}

/** ヘッダーを「小文字の名前 → 値」にする */
export function headerMap(payload: GmailPart | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of payload?.headers ?? []) out[h.name.toLowerCase()] = h.value;
  return out;
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | null {
  if (!part) return null;
  if ((part.mimeType ?? '').toLowerCase().startsWith(mime) && part.body?.data && !part.filename) return part;
  for (const p of part.parts ?? []) {
    const hit = findPart(p, mime);
    if (hit) return hit;
  }
  return null;
}

function decode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

/** 本文テキスト。text/plain優先、無ければHTMLのタグを外す。文字化けが多い・空ならスニペットを使う */
export function extractBodyText(msg: GmailMessage): string {
  const plain = findPart(msg.payload, 'text/plain');
  let text = '';
  if (plain?.body?.data) {
    text = decode(plain.body.data);
  } else {
    const html = findPart(msg.payload, 'text/html');
    if (html?.body?.data) {
      text = decode(html.body.data)
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  const broken = (text.match(/�/g) ?? []).length;
  if (!text || broken > text.length * 0.05) return (msg.snippet ?? '').trim();
  return text;
}

/**
 * 未対応の再確認。返信済みなら 'replied'、アーカイブ済み(または削除)なら 'archived'、まだなら null。
 * checkArchive=false は「受信時に受信トレイに無かった」メール用(フィルタで受信トレイを通らないものを誤って閉じない)。
 */
export function threadResolution(messages: GmailMessage[] | null, messageId: string, checkArchive: boolean): 'replied' | 'archived' | null {
  if (messages === null) return 'archived';
  const target = messages.find((m) => m.id === messageId);
  if (!target) return 'archived';
  const receivedAt = Number(target.internalDate ?? 0);
  const replied = messages.some(
    (m) => m.id !== messageId && (m.labelIds ?? []).includes('SENT') && Number(m.internalDate ?? 0) > receivedAt,
  );
  if (replied) return 'replied';
  if (checkArchive && !(target.labelIds ?? []).includes('INBOX')) return 'archived';
  return null;
}
