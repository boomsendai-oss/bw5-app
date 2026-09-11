// 受信箱アラート: Pushover通知の組み立て(純関数)と送信。
// 優先度は通常(0)固定=おやすみモード中は鳴らさない(2026-09-11 TARO確認)。
import type { Kind } from './classify';
import { truncateChars } from './format';

export const KIND_TITLE: Record<Kind, string> = {
  new_inquiry: '【新規の問い合わせ】',
  reply: '【返信】',
  money_deadline: '【期限あり】',
  automation_failure: '【自動化の失敗】',
  money_later: '【お金・契約】',
  other: '【要確認】',
};

export type PushoverMessage = { title: string; message: string; url?: string; url_title?: string };

/** From ヘッダーの表示名。無ければアドレス */
export function displaySender(from: string): string {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m && m[1].trim()) return m[1].trim();
  return (m ? m[2] : from).trim();
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
}): PushoverMessage {
  const head = input.aiFailed ? '【AI判定できず】' : KIND_TITLE[input.kind];
  const lines = [`差出人: ${displaySender(input.from)}`];
  if (input.summary) lines.push(`要約: ${input.summary}`);
  return {
    title: truncateChars(`${head}${input.subject || '(件名なし)'}`, 250),
    message: truncateChars(lines.join('\n'), 1024),
    url: input.link,
    url_title: 'Gmailで開く',
  };
}

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
  const res = await fetchImpl('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: number; errors?: string[] };
  if (!res.ok || json.status !== 1) {
    throw new Error(`pushover ${res.status} ${(json.errors ?? []).join(',')}`.trim());
  }
}
