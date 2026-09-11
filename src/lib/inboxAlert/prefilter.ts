// 受信箱アラート: メールをAIに読ませる前に、ラベルとヘッダーだけで「読み方」を決める(純関数)。
// 宣伝・SNSは件数だけ数える。自動送信はルールで捨てず、AIに冒頭だけ読ませる
// (hacomonoの「公式LINEよりメッセージ送付をお願いします」やStripe決済など、気づくべきものが混ざるため)。
export type ReadMode = 'count_only' | 'ai_light' | 'ai_full';

export type MessageMeta = {
  labelIds: string[];
  /** ヘッダー名は小文字 */
  headers: Record<string, string>;
};

/** 自動送信とみなす差出人ドメイン(サブドメインも含む)。増減はここを直す */
export const KNOWN_AUTOMATED_DOMAINS = ['bank.gmo-aozora.com', 'mail.gmo-aozora.com', 'amazon.co.jp'];

const AUTOMATED_LOCAL_PART = /^(no-?reply|do-?not-?reply|notifications?|notify|mailer-daemon|alerts?)([._+-]|$)/i;

/** From ヘッダーからメールアドレス部分だけを取り出す(小文字) */
export function senderAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  const raw = (angle ? angle[1] : from).trim().toLowerCase();
  const bare = raw.match(/[^\s"<>]+@[^\s"<>]+/);
  return bare ? bare[0] : raw;
}

export function senderDomain(from: string): string {
  const addr = senderAddress(from);
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1) : '';
}

function isKnownAutomatedDomain(domain: string): boolean {
  return KNOWN_AUTOMATED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function decideReadMode(meta: MessageMeta): ReadMode {
  const labels = meta.labelIds;
  if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL')) return 'count_only';

  const h = meta.headers;
  const from = h['from'] ?? '';
  const precedence = (h['precedence'] ?? '').trim().toLowerCase();
  const autoSubmitted = (h['auto-submitted'] ?? 'no').trim().toLowerCase();
  const localPart = senderAddress(from).split('@')[0] ?? '';

  const automated =
    'list-unsubscribe' in h ||
    ['bulk', 'list', 'junk'].includes(precedence) ||
    autoSubmitted !== 'no' ||
    AUTOMATED_LOCAL_PART.test(localPart) ||
    isKnownAutomatedDomain(senderDomain(from));

  return automated ? 'ai_light' : 'ai_full';
}
