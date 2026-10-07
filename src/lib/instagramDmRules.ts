// src/lib/instagramDmRules.ts — Instagram DM 自動返信の判定ルールと定型文(純関数・DB/ネット不使用)。
//
// 方針(TARO 2026-10-07):
//   - 外部(非会員)の申込窓口はインスタDMにも開く。DMは「自動で受け取って定型文を返し、台帳に残す」。
//   - 返せるのは案内の定型文だけ。申込の確定・個別の相談は人(TARO)が返す。自動返信は台帳に
//     「返信待ち」を立てて止まる(fail-closed・勝手に約束しない)。
//   - 文面は広告臭を出さない(生徒向け告知文のトーン)。✅列挙・煽り・レトリカルクエスチョン禁止。
//
// ルール:
//   1. 1スレッド(=送信者)につき同じ種類の自動返信は1回だけ。
//   2. 1スレッドにつき自動返信は24時間で最大 MAX_AUTO_PER_DAY 通。
//   3. 本文なし(スタンプ・画像だけ)には返さない。
//   4. どの種類にも当たらない初回メッセージには「受け取りました」だけ返す(greeting)。
//   5. 2通目以降で種類が当たらなければ自動返信なし→返信待ち。

export type DmKind = 'ws' | 'ws_apply' | 'trial' | 'greeting' | 'handoff';

/** 全ての自動返信の末尾に付ける(自動であることを隠さない・TARO 2026-10-07)。 */
export const AUTO_NOTE = '※この返信は自動送信です。内容はスタッフが後ほど確認し、必要に応じて改めてご連絡いたします。';

export const MAX_AUTO_PER_DAY = 3;

export const OFFICIAL_LINE_URL = 'https://lin.ee/4EYB9zZ';

/** 期間限定の案内(終わったら消す)。valid_until を過ぎると ws 判定は trial/greeting に落ちる。 */
export const WS_INFO = {
  key: 'yua_house_ws_20261025',
  validUntil: '2026-10-25T17:15:00+09:00',
  keywords: ['ワークショップ', 'ワークショッフ', 'WS', 'ws', '唯愛', 'ゆあ', 'YUA', 'yua', 'HOUSE', 'house', 'ハウス', '10/25', '10月25'],
  text: [
    'お問い合わせありがとうございます。BOOMダンススクールです。',
    '10月25日(日)開催「唯愛 HOUSE WORKSHOP」のご案内です。',
    '',
    '■ 日時：10月25日(日) 15:45〜17:15',
    '■ 会場：AZUMAスタジオ（仙台市青葉区二日町7 5F）',
    '■ 参加費：2,000円（当日現金）',
    '■ 定員：15名',
    '■ 内容：振り付けより「踊り方」を中心としたレッスンです。HOUSEが初めての方、他ジャンルの方もご参加いただけます。',
    '',
    '【お申込み方法】',
    'このDMに、以下の2点をご返信ください。',
    '・参加される方のお名前',
    '・当日連絡のつく電話番号',
    '',
    'ご返信を確認後、担当者より受付のご連絡をいたします。',
    '※前日以降のキャンセルは、参加費をいただく場合がございます。',
    '※BOOM会員の方は、会員ポータル(HACOMONO)からご予約ください。',
  ].join('\n'),
};

export const TEMPLATES: Record<DmKind, string> = {
  ws: WS_INFO.text,
  ws_apply: [
    'お申込みありがとうございます。内容を受け付けました。',
    '定員の空き状況を確認のうえ、担当者より折り返しご連絡いたします。',
    '',
    '■ 当日のご案内',
    '・開始10分前までに会場へお越しください',
    '・会場：AZUMAスタジオ（仙台市青葉区二日町7 5F）',
    '・参加費：2,000円（当日現金でお支払いください）',
    '',
    '■ キャンセルについて',
    'ご都合が悪くなった場合は、このDMにてご連絡ください。',
    '前日以降のキャンセルは、参加費をいただく場合がございます。',
  ].join('\n'),
  trial: [
    'お問い合わせありがとうございます。BOOMダンススクールです。',
    '',
    '体験レッスンは無料でご参加いただけます。',
    '日程・会場・クラスのご確認とご予約は、公式LINEから承っております。',
    OFFICIAL_LINE_URL,
    '',
    'LINEのご利用が難しい場合は、このDMに以下をご返信ください。',
    '・ご希望のジャンル',
    '・年齢（お子さまの場合は学年）',
    '・通いやすいエリア',
    '',
    '担当者より折り返しご連絡いたします。',
  ].join('\n'),
  greeting: [
    'お問い合わせありがとうございます。BOOMダンススクールです。',
    '',
    '内容を確認のうえ、担当者より順番にご返信いたします。',
    'お急ぎの場合は、公式LINEからもご連絡いただけます。',
    OFFICIAL_LINE_URL,
  ].join('\n'),
  // 2通目以降で定型に当たらない／噛み合っていない時の逃げ道。これを送ったら、そのスレッドの自動返信は止める。
  handoff: [
    'ご連絡ありがとうございます。',
    'こちらの内容は、担当者が確認のうえ直接ご返信いたします。',
    '恐れ入りますが、今しばらくお待ちください。',
    '',
    'お急ぎの場合は、公式LINEからもご連絡いただけます。',
    OFFICIAL_LINE_URL,
  ].join('\n'),
};

/** 送信する本文(定型文＋自動送信の断り)。handoff は本文自体が「人に引き継ぐ」宣言なので断りを付けない。 */
export function renderTemplate(kind: DmKind): string {
  return kind === 'handoff' ? TEMPLATES[kind] : `${TEMPLATES[kind]}\n\n${AUTO_NOTE}`;
}

// 噛み合っていない・人を呼んでいるサイン。これが来たら定型を返さず handoff。
const CONFUSION_KEYWORDS = ['違う', '違います', 'ちがう', 'そうじゃなく', 'ではなく', 'じゃなくて', '自動', 'ボット', 'bot', '担当者', '直接', '伝わって', '分かりません', 'わかりません', '意味が', '質問が'];
// 相槌・お礼だけ。返信不要(沈黙でよい)。
const ACK_ONLY = /^(ありがとうございます|ありがとうございました|ありがとう|了解です|了解しました|承知しました|わかりました|分かりました|はい|よろしくお願いします|よろしくお願いいたします|お願いします|助かります)[！!。．\s]*$/;

const TRIAL_KEYWORDS = ['体験', '見学', '入会', '料金', '月謝', 'レッスン', 'クラス', 'スケジュール', '何歳', '初心者', '通い'];
const APPLY_KEYWORDS = ['申込', '申し込', '参加希望', '参加したい', '参加します', '予約', '行きたい', '行きます', '出たい'];

function includesAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w.toLowerCase()));
}

/** 電話番号らしき並び(090-1234-5678 / 09012345678 / 全角数字も)。 */
export function containsPhoneNumber(text: string): boolean {
  const digits = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return /0\d{1,4}[-‐−ー\s]?\d{1,4}[-‐−ー\s]?\d{3,4}/.test(digits) && digits.replace(/\D/g, '').length >= 10;
}

/** 「名前・電話番号(または人数)」を送ってきたっぽいか(自動返信 ws_apply の判定)。 */
export function looksLikeApplication(text: string): boolean {
  if (containsPhoneNumber(text)) return true;
  if (/[0-9０-９一二三四五六七八九十]\s*[人名]/.test(text)) return true;
  if (/(ひとり|一人|1人|二人|ふたり|2人)/.test(text)) return true;
  return includesAny(text, APPLY_KEYWORDS);
}

export type ThreadContext = {
  /** このスレッドで過去に送った自動返信の種類 */
  autoReplyKinds: DmKind[];
  /** 直近24時間に送った自動返信の数 */
  autoRepliesLast24h: number;
  /** このスレッドの受信メッセージ数(今回を含まない) */
  inboundCountBefore: number;
  /** 判定時刻(ISO)。WSの有効期限判定に使う */
  now: string;
};

export function wsActive(nowIso: string): boolean {
  return new Date(nowIso).getTime() <= new Date(WS_INFO.validUntil).getTime();
}

/** 本文から種類を決める(文脈なし)。null=当たらない。 */
export function classify(text: string, nowIso: string, wsContext = false): DmKind | null {
  const t = text.trim();
  if (!t) return null;
  const ws = wsActive(nowIso);
  if (ws && (wsContext || includesAny(t, WS_INFO.keywords)) && looksLikeApplication(t)) return 'ws_apply';
  if (ws && includesAny(t, WS_INFO.keywords)) return 'ws';
  if (includesAny(t, TRIAL_KEYWORDS)) return 'trial';
  return null;
}

export type Decision = { kind: DmKind; text: string } | { kind: null; reason: string };

/** 自動返信するか・何を返すかを決める。送らない理由も返す(台帳に残す)。 */
export function decideAutoReply(text: string, ctx: ThreadContext): Decision {
  const t = (text || '').trim();
  if (!t) return { kind: null, reason: '本文なし(スタンプ/画像)' };
  if (ctx.autoRepliesLast24h >= MAX_AUTO_PER_DAY) return { kind: null, reason: '24時間の自動返信上限' };

  // 一度「スタッフに引き継ぐ」と言ったスレッドでは、以後いっさい自動で返さない(人が返す)
  if (ctx.autoReplyKinds.includes('handoff')) return { kind: null, reason: 'スタッフ引き継ぎ済み' };
  if (ACK_ONLY.test(t)) return { kind: null, reason: '相槌・お礼のみ' };
  if (includesAny(t, CONFUSION_KEYWORDS)) return { kind: 'handoff', text: renderTemplate('handoff') };

  const wsContext = ctx.autoReplyKinds.includes('ws');
  let kind = classify(t, ctx.now, wsContext);
  if (!kind && ctx.inboundCountBefore === 0) kind = 'greeting';
  // 2通目以降で定型に当たらない＝自動では噛み合わない。黙らずに「人が返す」と伝えて止める
  if (!kind) kind = 'handoff';
  if (kind !== 'handoff' && ctx.autoReplyKinds.includes(kind)) {
    // 同じ案内を2回は送らない。繰り返し聞かれている＝噛み合っていないので人に引き継ぐ
    kind = 'handoff';
  }
  return { kind, text: renderTemplate(kind) };
}

/** 自動返信のあとスレッドをどの状態に置くか。人の返信が要るものは needs_reply。 */
export function statusAfter(kind: DmKind | null): 'auto_replied' | 'needs_reply' {
  if (kind === 'ws' || kind === 'trial') return 'auto_replied';
  return 'needs_reply';
}
