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

export type DmKind = 'ws' | 'ws_apply' | 'trial' | 'greeting';

export const MAX_AUTO_PER_DAY = 3;

export const OFFICIAL_LINE_URL = 'https://lin.ee/4EYB9zZ';

/** 期間限定の案内(終わったら消す)。valid_until を過ぎると ws 判定は trial/greeting に落ちる。 */
export const WS_INFO = {
  key: 'yua_house_ws_20261025',
  validUntil: '2026-10-25T17:15:00+09:00',
  keywords: ['ワークショップ', 'ワークショッフ', 'WS', 'ws', '唯愛', 'ゆあ', 'YUA', 'yua', 'HOUSE', 'house', 'ハウス', '10/25', '10月25'],
  text: [
    'メッセージありがとうございます！BOOMです😊',
    '10/25(日)の唯愛さんHOUSEワークショップについてですね。',
    '',
    '🏠 10/25(日) 15:45〜17:15',
    '📍 AZUMAスタジオ（仙台市青葉区二日町7 5F）',
    '💰 ¥2,000（当日現金）／定員15名',
    '',
    'ルーティーンを覚えるというより「踊り方」が中心の内容なので、HOUSEが初めての方もジャンルが違う方も大丈夫です。',
    '',
    '参加希望の方は、このままDMで「お名前・人数」を送ってください。こちらで受付して折り返しご連絡します。',
    '※BOOM会員の方はポータル(HACOMONO)の予約画面からお願いします。',
  ].join('\n'),
};

export const TEMPLATES: Record<DmKind, string> = {
  ws: WS_INFO.text,
  ws_apply: [
    'ありがとうございます！受け付けました。',
    '定員(15名)の空きを確認して、担当のTAROから折り返しご連絡します。',
    '当日は開始10分前までにAZUMAスタジオ（仙台市青葉区二日町7 5F）へお越しください。参加費¥2,000は当日現金でお願いします。',
  ].join('\n'),
  trial: [
    'メッセージありがとうございます！BOOMです😊',
    '体験レッスンは無料です。日程・会場・クラスは公式LINEから予約できます。',
    OFFICIAL_LINE_URL,
    '',
    'LINEが使いにくければ、このDMに「ご希望のジャンル・年齢(お子さまなら学年)・通いやすいエリア」を送ってください。担当から折り返しご連絡します。',
  ].join('\n'),
  greeting: [
    'メッセージありがとうございます！BOOMです😊',
    '順番にお返事しますので、少しお待ちください。',
    'お急ぎの方は公式LINEからもご連絡いただけます。',
    OFFICIAL_LINE_URL,
  ].join('\n'),
};

const TRIAL_KEYWORDS = ['体験', '見学', '入会', '料金', '月謝', 'レッスン', 'クラス', 'スケジュール', '何歳', '初心者', '通い'];
const APPLY_KEYWORDS = ['申込', '申し込', '参加希望', '参加したい', '参加します', '予約', '行きたい', '行きます', '出たい'];

function includesAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w.toLowerCase()));
}

/** 「名前・人数」を送ってきたっぽいか(自動返信 ws_apply の判定)。数字+人 or 「名」 or 「人」の表現。 */
export function looksLikeApplication(text: string): boolean {
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

  const wsContext = ctx.autoReplyKinds.includes('ws');
  let kind = classify(t, ctx.now, wsContext);
  if (!kind && ctx.inboundCountBefore === 0) kind = 'greeting';
  if (!kind) return { kind: null, reason: '定型に当たらない(2通目以降)' };
  if (ctx.autoReplyKinds.includes(kind)) return { kind: null, reason: `同じ種類(${kind})は送信済み` };
  return { kind, text: TEMPLATES[kind] };
}

/** 自動返信のあとスレッドをどの状態に置くか。人の返信が要るものは needs_reply。 */
export function statusAfter(kind: DmKind | null): 'auto_replied' | 'needs_reply' {
  if (kind === 'ws' || kind === 'trial') return 'auto_replied';
  return 'needs_reply';
}
