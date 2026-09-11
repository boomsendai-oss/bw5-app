// 受信箱アラート: メールをAIに読ませる前に、ラベルとヘッダーだけで「読み方」を決める(純関数)。
// 件数だけ数える(AIが読まない)のは「Gmailが宣伝・SNSに分類」かつ「一斉配信の印がある」メールだけ。
// 印の無い宣伝分類は、人のメールをGmailが誤分類した可能性があるので読む(見逃すより読みすぎる方をとる)。
// 自動送信はルールで捨てず、AIに冒頭だけ読ませる
// (hacomonoの「公式LINEよりメッセージ送付をお願いします」やStripe決済など、気づくべきものが混ざるため)。
export type ReadMode = 'count_only' | 'ai_light' | 'ai_full';

export type MessageMeta = {
  labelIds: string[];
  /** ヘッダー名は小文字 */
  headers: Record<string, string>;
};

/** 自動送信とみなす差出人ドメイン(サブドメインも含む)。増減はここを直す */
export const KNOWN_AUTOMATED_DOMAINS = ['bank.gmo-aozora.com', 'mail.gmo-aozora.com', 'amazon.co.jp'];

const AUTOMATED_LOCAL_PART =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|notify|mailer-daemon|alerts?)([._+-]|$)/i;

/** From ヘッダーからメールアドレス部分だけを取り出す(小文字)。表示名の中の <...> や、複数宛先の区切りに惑わされない */
export function senderAddress(from: string): string {
  const angle = from.match(/<([^<>]+)>\s*$/);
  const raw = (angle ? angle[1] : from).trim().toLowerCase();
  const bare = raw.match(/[^\s"<>,;()]+@[^\s"<>,;()]+/);
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
  const h = meta.headers;
  const from = h['from'] ?? '';
  const precedence = (h['precedence'] ?? '').trim().toLowerCase();
  const autoSubmitted = (h['auto-submitted'] ?? '').trim().toLowerCase() || 'no';
  const localPart = senderAddress(from).split('@')[0] ?? '';

  const bulk =
    'list-unsubscribe' in h ||
    ['bulk', 'list', 'junk'].includes(precedence) ||
    isKnownAutomatedDomain(senderDomain(from));

  const labels = meta.labelIds;
  const promotional = labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL');
  if (promotional && bulk) return 'count_only';

  const automated = bulk || !/^no\b/.test(autoSubmitted) || AUTOMATED_LOCAL_PART.test(localPart);
  return automated ? 'ai_light' : 'ai_full';
}
