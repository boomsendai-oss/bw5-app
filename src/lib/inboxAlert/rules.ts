// 受信箱アラート: AIに読ませる前の決め打ちルール(30日の事前テストで分かったことを反映)。
// ねらいは2つ。
//  (1) 機械が同じ形で出す通知は、AIの判定がぶれないよう固定する
//      (同じ体験予約の通知12通が now 10 / digest 1 / count 1 に割れた。新規のお客さんの通知を落とすのが一番痛い)
//  (2) 毎回 count にしかならない銀行・ショップの通知はAIに読ませない(AI費用のほとんどがこれだった)
// 見る順番: 決め打ちの tier(A-1) → 例外キーワード(A-2) → AIに読ませない一覧(A-3)。先に当たったものが勝つ。
// ドメインは完全一致かサブドメインだけを見る(部分一致にしない。templatebank.com が 77bank.jp に当たらないように)。
import type { Kind, Tier } from './classify';

export type RuleMatch = { tier: Tier; kind: Kind; source: 'fixed' | 'exception' };

type FixedRule = { domain: string; keywords: string[]; tier: Tier; kind: Kind };

/** 予約の取り消し・変更。30日間では1通も来なかったが、来たら必ず鳴らす(来てから気づくのでは遅い) */
const CANCEL_WORDS = ['キャンセル', '取消', '日程変更'];

/** A-1: AIを呼ばずに tier と kind を決めるルール。上から順に見て、先に当たったものが勝つ */
const FIXED_RULES: FixedRule[] = [
  // 「口座振替不能」は「口座振替」より前に置く(お金が引き落とせていない=期限つき。朝のまとめに埋もれさせない)
  { domain: 'hacomono.co.jp', keywords: ['口座振替不能'], tier: 'now', kind: 'money_deadline' },
  { domain: 'service.linestep.net', keywords: ['体験レッスン', '見学が入りました'], tier: 'now', kind: 'new_inquiry' },
  { domain: 'service.linestep.net', keywords: ['回答フォーム申し込み'], tier: 'now', kind: 'new_inquiry' },
  { domain: 'service.linestep.net', keywords: CANCEL_WORDS, tier: 'now', kind: 'other' },
  { domain: 'em.hacomono.jp', keywords: ['プラン契約完了'], tier: 'now', kind: 'other' },
  { domain: 'em.hacomono.jp', keywords: ['プラン変更完了'], tier: 'now', kind: 'other' },
  { domain: 'em.hacomono.jp', keywords: CANCEL_WORDS, tier: 'now', kind: 'other' },
  { domain: 'em.hacomono.jp', keywords: ['口座振替', '決済処理', '請求'], tier: 'digest', kind: 'money_later' },
];

/** A-3のうち銀行・証券。「エラー」を鳴らす合図として扱うのはこのドメインだけ(Search Consoleのエラー通知で鳴らさないため) */
const BANK_DOMAINS = [
  'netbk.co.jp',
  'bank.gmo-aozora.com',
  'mail.gmo-aozora.com',
  'cc.paypay-bank.co.jp',
  'paypay-bank.co.jp',
  'mail.rakuten-bank.co.jp',
  '77bank.jp',
  'rakuten-sec.co.jp',
];

/** A-3: 取引や宣伝の知らせしか来ないのでAIに読ませない(例外キーワードに当たった時だけ鳴らす) */
const DROP_DOMAINS = [
  ...BANK_DOMAINS,
  'facebookmail.com',
  'emagazine.rakuten.co.jp',
  'zozo.jp',
  'superdelivery.com',
  'uber.com',
  'moneyforward.com',
  'email.beatport.com',
  'amazon.co.jp',
  'hacomono.jp',
];

/** A-4: 同じ差出人から本物の仕事も届くので、宣伝・一斉配信の印があっても全文を読む */
const ALWAYS_FULL_DOMAINS = ['libecity.com', 'form.run', 'siip.city.sendai.jp', 'hacomono.co.jp'];

/** A-2: 「本当に何かが起きている」合図。30日間で11通あり、どれも取りこぼせない */
const TROUBLE = /不成立|不能|出金停止|実施されませんでした|利用不可/;
/** 「解除」が付くのは復旧の知らせなので鳴らさない(利用停止解除・未精算解除) */
const TROUBLE_UNLESS_CLEARED = /未精算|利用停止/;

/** 完全一致か、そのドメインのサブドメイン。部分一致はしない */
export function domainIs(domain: string, target: string): boolean {
  const d = (domain ?? '').toLowerCase();
  return d === target || d.endsWith(`.${target}`);
}

const matchesAny = (domain: string, targets: string[]) => targets.some((t) => domainIs(domain, t));

/** A-3: このドメインはAIに読ませない(件数だけ数える) */
export const isDropDomain = (domain: string): boolean => matchesAny(domain, DROP_DOMAINS);

/** A-4: このドメインは宣伝の印があっても全文を読む */
export const isAlwaysFullDomain = (domain: string): boolean => matchesAny(domain, ALWAYS_FULL_DOMAINS);

/** A-2: 件名が「何かが起きている」合図を含むか。含めば鳴らす(AIに読ませない一覧のドメインでも) */
export function exceptionMatch(domain: string, subject: string): RuleMatch | null {
  const s = subject ?? '';
  const promote: RuleMatch = { tier: 'now', kind: 'money_deadline', source: 'exception' };
  // 「不可」だけを見ると「返信不可」「学生不可」で鳴るので、「利用不可」まで含めて見る
  if (TROUBLE.test(s)) return promote;
  if (TROUBLE_UNLESS_CLEARED.test(s) && !s.includes('解除')) return promote;
  if (s.includes('エラー') && matchesAny(domain, BANK_DOMAINS)) return promote;
  return null;
}

/**
 * AIを呼ばずに tier と kind を決められるか。決め打ち(A-1) → 例外キーワード(A-2) の順に見て、当たらなければ null。
 * 決め打ちのうち now でないものは、例外キーワードに当たっていたらそちらを優先する
 * (「口座振替不能」を「口座振替」の digest で埋めないため)
 */
export function ruleClassify(domain: string, subject: string): RuleMatch | null {
  const s = subject ?? '';
  const exception = exceptionMatch(domain, s);
  for (const rule of FIXED_RULES) {
    if (!domainIs(domain, rule.domain)) continue;
    if (!rule.keywords.some((k) => s.includes(k))) continue;
    if (rule.tier !== 'now' && exception) return exception;
    return { tier: rule.tier, kind: rule.kind, source: 'fixed' };
  }
  return exception;
}
