// 受信箱アラート: AIに読ませる前の決め打ちルール(30日の事前テスト1,591通をTAROと確認して決めた)。
// ねらいは3つ。
//  (1) 機械が同じ形で出す通知は、AIの判定がぶれないよう固定する
//      (同じ体験予約の通知12通が now 10 / digest 1 / count 1 に割れた。新規のお客さんの通知を落とすのが一番痛い)
//  (2) 毎回 count にしかならない銀行・ショップ・メルマガはAIに読ませない(AI費用のほとんどがこれ)
//  (3) 乗っ取りの兆候とお金の失敗は、何があっても鳴らす
// 見る順番: 決め打ちの tier(A-1) → 例外キーワード(A-2) → AIに読ませない一覧(A-3)。先に当たったものが勝つ。
// 差出人はアドレス(完全一致)かドメイン(完全一致かサブドメイン)で見る。部分一致はしない
// (templatebank.com が 77bank.jp に当たらないように。ドメインで止めると本物の連絡まで消えるものはアドレスで指定する)。
// 各ルールのコメントの件数は、30日の事前テストでの実測値。
import type { Kind, Tier } from './classify';

export type RuleMatch = { tier: Tier; kind: Kind; source: 'fixed' | 'exception' };

type Matcher = {
  /** 差出人アドレスの完全一致(小文字) */
  addresses?: string[];
  /** 差出人ドメイン(完全一致かサブドメイン) */
  domains?: string[];
  /** 件名がこれに当たること(指定しなければ件名は問わない) */
  subject?: RegExp;
  /** 件名がこれに当たる時は対象外にする */
  unless?: RegExp;
};

type FixedRule = Matcher & { tier: Tier; kind: Kind };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyOf = (words: string[]) => new RegExp(words.map(escapeRegExp).join('|'));

/** 予約の取り消し・変更。30日間では1通も来なかったが、来たら必ず鳴らす(来てから気づくのでは遅い) */
const CANCEL_WORDS = ['キャンセル', '取消', '日程変更'];
/** R9 行政手続き(水道・法人番号)。6通 */
const GOV_DOMAINS = ['gbiz-id.go.jp', 'water.city.sendai.jp', 'suido.f-regi.com'];

/** A-1: AIを呼ばずに tier と kind を決めるルール。上から順に見て、先に当たったものが勝つ */
const FIXED_RULES: FixedRule[] = [
  // R1 乗っ取りの兆候(5通)。どの差出人から来ても最優先で鳴らす
  {
    subject: /Security alert|passkey added|trusted device added|access token has been added|新しい環境からログイン/,
    tier: 'now',
    kind: 'other',
  },

  // 「口座振替不能」は「口座振替」より前に置く(お金が引き落とせていない=期限つき。朝のまとめに埋もれさせない)
  { domains: ['hacomono.co.jp'], subject: anyOf(['口座振替不能']), tier: 'now', kind: 'money_deadline' },

  // R4 体験・見学の申し込み(Lステップ)
  { domains: ['service.linestep.net'], subject: anyOf(['体験レッスン', '見学が入りました']), tier: 'now', kind: 'new_inquiry' },
  { domains: ['service.linestep.net'], subject: anyOf(['回答フォーム申し込み']), tier: 'now', kind: 'new_inquiry' },
  { domains: ['service.linestep.net'], subject: anyOf(CANCEL_WORDS), tier: 'now', kind: 'other' },

  // R3 hacomono(会員の契約まわり)
  { domains: ['em.hacomono.jp'], subject: anyOf(['プラン契約完了']), tier: 'now', kind: 'other' },
  { domains: ['em.hacomono.jp'], subject: anyOf(['プラン変更完了']), tier: 'now', kind: 'other' },
  { domains: ['em.hacomono.jp'], subject: anyOf(CANCEL_WORDS), tier: 'now', kind: 'other' },
  { domains: ['em.hacomono.jp'], subject: anyOf(['口座振替', '決済処理', '請求']), tier: 'digest', kind: 'money_later' },

  // R9 行政手続き。手続きの開始・期限だけ鳴らし、それ以外は朝のまとめ
  { domains: GOV_DOMAINS, subject: /手続き開始|期限|締切/, tier: 'now', kind: 'money_deadline' },
  { domains: GOV_DOMAINS, tier: 'digest', kind: 'other' },

  // R5 Amazonの出品者とのやりとり(9通)。amazon.co.jp はAIに読ませない一覧にあるが、これは人からの連絡なので先に拾う
  { addresses: ['marketplace-messages@amazon.co.jp'], tier: 'digest', kind: 'reply' },

  // R10 Search Console(件名を絞らないとアクセスレポートまで拾う)
  {
    addresses: ['sc-noreply@google.com', 'googlebase-noreply@google.com'],
    subject: /インデックス|エラー|quality report/i,
    tier: 'digest',
    kind: 'other',
  },

  // R2 ログイン・確認コード(17通)。見なくてもよいが、身に覚えがない時に気づけるよう朝のまとめには載せる
  {
    addresses: ['no-reply@accounts.google.com', 'families-noreply@google.com', 'hello@1password.com', 'security@facebookmail.com'],
    tier: 'digest',
    kind: 'other',
  },
  { subject: /ログインがありました/, tier: 'digest', kind: 'other' },
  { domains: ['github.com'], subject: /verification code/i, tier: 'digest', kind: 'other' },

  // R6 請求書・課金(3通)。除外語を入れないと、宣伝メール4通を巻き込む
  {
    subject: /invoice|請求書|課金のお知らせ|適格請求書/i,
    unless: /領収書|receipt|先延ばし|延ばせる|新機能|キャンペーン|ご紹介|予告|お得/i,
    tier: 'digest',
    kind: 'money_later',
  },

  // R7 障害情報(1通)
  { subject: /障害(発生|情報|のお知らせ)/, tier: 'digest', kind: 'automation_failure' },

  // R8 問い合わせの受付・審査完了(3通)。Re: 付きは本物の返信なので、今までどおり鳴らす
  {
    subject: /審査完了|お問合せありがとう|お問い合わせありがとう|追加情報をご提供いただき/,
    unless: /^Re:/i,
    tier: 'digest',
    kind: 'reply',
  },
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

/**
 * C: アドレスを指定して止める。同じドメインから本物の連絡も来るので、ドメインごとは止めない
 * (hacomono は請求 accounting@ とサポートの担当者、仙台商工会議所は担当者個人のアドレスを読み続ける)
 */
const DROP_ADDRESSES = [
  'mail@form.run', // フォームの宣伝(37通)。本物のフォーム通知は別のアドレスから届く
  'e-kigyoudayori@siip.city.sendai.jp', // 仙台市の企業だより(52通)。補助金の号もTAROは不要と判断
  'info@sendaicci.or.jp', // 仙台商工会議所の一斉配信(4通)
  'marketing@hacomono.co.jp',
  'partnersales@hacomono.co.jp',
  'info@hacomono.jp',
];

/** C: 差出人ではなく件名で止めるもの。gmail.com 全体は絶対に止めない(お客さんのメールが消える) */
const DROP_SUBJECT_RULES: Matcher[] = [{ domains: ['gmail.com'], subject: /共有カレンダー/ }];

/** A-4: 同じ差出人から本物の仕事も届くので、宣伝・一斉配信の印があっても全文を読む */
const ALWAYS_FULL_DOMAINS = ['libecity.com', 'form.run', 'hacomono.co.jp'];

/**
 * A-2: 「本当に何かが起きている」合図。30日間で11通あり、どれも取りこぼせない。
 * failed は入れない(GitHub ActionsやVercelの失敗通知38通が鳴ってしまい、朝のまとめで足りている)。
 * 【重要】も入れない(17通のうち4通はTAROが不要と判断した宣伝だった)
 */
const TROUBLE = /不成立|不能|出金停止|実施されませんでした|利用不可|Action required|Action needed/i;
/** 「解除」が付くのは復旧の知らせなので鳴らさない(利用停止解除・未精算解除) */
const TROUBLE_UNLESS_CLEARED = /未精算|利用停止/;

/** 完全一致か、そのドメインのサブドメイン。部分一致はしない */
export function domainIs(domain: string, target: string): boolean {
  const d = (domain ?? '').toLowerCase();
  return d === target || d.endsWith(`.${target}`);
}

const normalize = (address: string) => (address ?? '').trim().toLowerCase();
const domainOf = (address: string) => {
  const at = normalize(address).lastIndexOf('@');
  return at >= 0 ? normalize(address).slice(at + 1) : '';
};
const matchesAnyDomain = (domain: string, targets: string[]) => targets.some((t) => domainIs(domain, t));

/** 差出人(アドレスかドメイン)と件名が、この条件に当てはまるか。差出人の指定が無いルールは件名だけで判定する */
function matches(m: Matcher, address: string, subject: string): boolean {
  const hasSender = (m.addresses?.length ?? 0) > 0 || (m.domains?.length ?? 0) > 0;
  const senderOk =
    !hasSender || (m.addresses ?? []).includes(address) || matchesAnyDomain(domainOf(address), m.domains ?? []);
  if (!senderOk) return false;
  if (m.subject && !m.subject.test(subject)) return false;
  if (m.unless && m.unless.test(subject)) return false;
  return true;
}

/** A-3: この差出人はAIに読ませない(件数だけ数える) */
export function isDropSender(address: string, subject = ''): boolean {
  const a = normalize(address);
  const s = subject ?? '';
  if (DROP_ADDRESSES.includes(a)) return true;
  if (DROP_SUBJECT_RULES.some((m) => matches(m, a, s))) return true;
  return matchesAnyDomain(domainOf(a), DROP_DOMAINS);
}

/** A-4: この差出人は宣伝の印があっても全文を読む */
export function isAlwaysFullSender(address: string): boolean {
  return matchesAnyDomain(domainOf(address), ALWAYS_FULL_DOMAINS);
}

/** A-2: 件名が「何かが起きている」合図を含むか。含めば鳴らす(AIに読ませない一覧の差出人でも) */
export function exceptionMatch(address: string, subject: string): RuleMatch | null {
  const s = subject ?? '';
  const promote: RuleMatch = { tier: 'now', kind: 'money_deadline', source: 'exception' };
  // 「不可」だけを見ると「返信不可」「学生不可」で鳴るので、「利用不可」まで含めて見る
  if (TROUBLE.test(s)) return promote;
  if (TROUBLE_UNLESS_CLEARED.test(s) && !s.includes('解除')) return promote;
  if (s.includes('エラー') && matchesAnyDomain(domainOf(address), BANK_DOMAINS)) return promote;
  return null;
}

/**
 * AIを呼ばずに tier と kind を決められるか。決め打ち(A-1) → 例外キーワード(A-2) の順に見て、当たらなければ null。
 * 決め打ちのうち now でないものは、例外キーワードに当たっていたらそちらを優先する
 * (「口座振替不能」を「口座振替」の digest で、支払い失敗の Action required を請求書の digest で埋めないため)
 */
export function ruleClassify(address: string, subject: string): RuleMatch | null {
  const a = normalize(address);
  const s = subject ?? '';
  const exception = exceptionMatch(a, s);
  for (const rule of FIXED_RULES) {
    if (!matches(rule, a, s)) continue;
    if (rule.tier !== 'now' && exception) return exception;
    return { tier: rule.tier, kind: rule.kind, source: 'fixed' };
  }
  return exception;
}
