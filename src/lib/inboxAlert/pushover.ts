// 受信箱アラート: Pushover通知の組み立て(純関数)と送信。
// 優先度は通常(0)固定=おやすみモード中は鳴らさない(2026-09-11 TARO確認)。
// 件名と差出人名は送り主が自由に書けるので、URLは消す(通知経由の誘導を防ぐ。電話番号は正当な件名を壊しやすいので残す)。
import type { Kind } from './classify';
import { stripUrls, truncateChars } from './format';

export const KIND_TITLE: Record<Kind, string> = {
  new_inquiry: '【新規の問い合わせ】',
  reply: '【返信】',
  money_deadline: '【期限あり】',
  automation_failure: '【自動化の失敗】',
  money_later: '【お金・契約】',
  other: '【要確認】',
};

export type PushoverMessage = {
  title: string;
  message: string;
  url?: string;
  url_title?: string;
  /** 通知に表示する時刻(秒)。再送でも「いつ届いたメールか」が分かるよう、受信時刻を入れる */
  timestamp?: number;
};

/** From ヘッダーの表示名。無ければドメインだけ(お客さんのメールアドレスをロック画面に出さないため) */
export function displaySender(from: string): string {
  const lt = from.lastIndexOf('<');
  const gt = from.lastIndexOf('>');
  const hasAngle = lt >= 0 && gt > lt;
  const name = (hasAngle ? from.slice(0, lt) : '')
    .trim()
    .replace(/^"([\s\S]*)"$/, '$1')
    .replace(/\\"/g, '"')
    .trim();
  if (name) return stripUrls(name);
  const address = (hasAngle ? from.slice(lt + 1, gt) : from).trim();
  const at = address.lastIndexOf('@');
  if (at >= 0) return address.slice(at + 1);
  return address || '(不明)';
}

/** そのアカウントでスレッドを開くGmailのURL(iPhoneでGmailアプリに渡るかは実機で確認する) */
export function gmailLink(email: string, threadId: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#all/${threadId}`;
}

export function buildNowMessage(input: {
  subject: string;
  from: string;
  summary: string;
  kind: Kind;
  aiFailed: boolean;
  link: string;
  receivedMs: number;
}): PushoverMessage {
  const head = input.aiFailed ? '【AI判定できず】' : KIND_TITLE[input.kind];
  const lines = [`差出人: ${displaySender(input.from)}`];
  if (input.summary) lines.push(`要約: ${input.summary}`);
  return {
    title: truncateChars(`${head}${stripUrls(input.subject) || '(件名なし)'}`, 250),
    message: truncateChars(lines.join('\n'), 1024),
    url: input.link,
    url_title: 'Gmailで開く',
    timestamp: Math.floor(input.receivedMs / 1000),
  };
}

/**
 * Pushoverに送れなかった。
 * tokenLevel=true は「その鍵では何を送ってもだめ」な失敗(時間切れ・通信エラー・5xx・429・鍵やユーザーキーが無効)。
 * false はそのメール1通だけの失敗(それ以外の4xx)で、他のメールではその鍵を使い続けてよい
 */
export class PushoverError extends Error {
  readonly status: number;
  readonly tokenLevel: boolean;
  constructor(message: string, status: number, tokenLevel: boolean) {
    super(message);
    this.name = 'PushoverError';
    this.status = status;
    this.tokenLevel = tokenLevel;
  }
}

type PushoverResponse = { status?: number; errors?: unknown[]; token?: string; user?: string };

/** アプリの鍵かユーザーキーが無効だと言っているか */
function saysKeyInvalid(json: PushoverResponse): boolean {
  if (json.token === 'invalid' || json.user === 'invalid') return true;
  return (json.errors ?? []).some((e) => /application token|user key|user identifier/i.test(String(e)));
}

const isAbort = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

export async function sendPushover(
  appToken: string,
  userKey: string,
  msg: PushoverMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const body = new URLSearchParams({
    token: appToken,
    user: userKey,
    title: msg.title,
    message: msg.message,
    priority: '0',
  });
  if (msg.url) body.set('url', msg.url);
  if (msg.url_title) body.set('url_title', msg.url_title);
  if (msg.timestamp) body.set('timestamp', String(msg.timestamp));
  let res: Response;
  try {
    res = await fetchImpl('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // 時間切れ・通信エラーは鍵ごと使えない扱い(Pushoverが固まっている時に、他のメールでも同じだけ待たない)
    throw new PushoverError(`pushover network ${e instanceof Error ? e.name : 'error'}`, 0, true);
  }
  let json: PushoverResponse = {};
  try {
    json = ((await res.json()) as PushoverResponse | null) ?? {};
  } catch (e) {
    // 本文を読む途中で時間切れになった時も、鍵ごと使えない扱い(JSONでないだけなら下で判定する)
    if (isAbort(e)) throw new PushoverError(`pushover ${res.status} ${(e as Error).name}`, res.status, true);
  }
  if (!res.ok || json.status !== 1) {
    const tokenLevel = res.status >= 500 || res.status === 429 || saysKeyInvalid(json);
    throw new PushoverError(`pushover ${res.status} ${(json.errors ?? []).join(',')}`.trim(), res.status, tokenLevel);
  }
}
