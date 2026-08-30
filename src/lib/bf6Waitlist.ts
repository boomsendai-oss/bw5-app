// BF6 キャンセル待ち。
//
// 設計の要点(TARO確定 2026-08-24):
//  - **お金を預からない**。繰り上がった人は当日会場で現金払い。
//    先に決済すると、繰り上がらなかった場合に返金処理が発生してしまうため。
//  - 順番は**申込順(先着)**。抽選にすると「なぜあの子が」の説明が要る。
//  - 繰り上げ通知への返答期限は通常48時間、本番直前(9/24以降)は24時間。
//  - 上限は**5名**。それ以上並んでも現実的に繰り上がらず、期待させるだけになる。
import { isValidBf6Email, isValidBf6Phone, isKatakanaText } from './bf6';

export const WAITLIST_CAPACITY = 5;

/** 通常は48時間。本番直前は待てないので24時間に切り替える。 */
export function offerDeadlineHours(todayJst: string): number {
  return todayJst >= '2026-09-24' ? 24 : 48;
}

export type WaitlistGate = 'ok' | 'not_full' | 'waitlist_full';

/** 満枠のときだけ受け付ける。空きがあるなら通常エントリーに回す。 */
export function canJoinWaitlist({ remaining, waiting }: { remaining: number; waiting: number }): WaitlistGate {
  if (remaining > 0) return 'not_full';
  if (waiting >= WAITLIST_CAPACITY) return 'waitlist_full';
  return 'ok';
}

export type WaitlistInput = {
  buyerName: string; email: string; phone: string;
  dancerName: string; dancerKana: string; performerName: string;
  grade: string; genre: string; rep: string; instagram: string;
};

/** 入力の検証。エラーは文字列、OKなら整形済みの値を返す。 */
export function validateWaitlistInput(input: WaitlistInput): WaitlistInput | string {
  const buyerName = input.buyerName.trim();
  if (!buyerName) return '保護者(お申込者)のお名前を入力してください';
  const email = input.email.trim();
  if (!isValidBf6Email(email)) return 'メールアドレスの形式が正しくありません';
  const phone = input.phone.trim();
  if (!isValidBf6Phone(phone)) return '電話番号の形式が正しくありません';
  const dancerName = input.dancerName.trim();
  if (!dancerName) return 'ダンサーネームを入力してください';
  const dancerKana = input.dancerKana.trim();
  if (!dancerKana) return 'フリガナを入力してください';
  if (!isKatakanaText(dancerKana)) return `フリガナ「${dancerKana}」はカタカナで入力してください`;
  const performerName = input.performerName.trim();
  if (!performerName) return '本名を入力してください';
  if (!input.grade) return '学年を選んでください';
  const genre = input.genre.trim();
  if (!genre) return 'ジャンルを入力してください';
  const rep = input.rep.trim();
  if (!rep) return 'レペゼンを入力してください';
  return { buyerName, email, phone, dancerName, dancerKana, performerName,
    grade: input.grade, genre, rep, instagram: input.instagram.trim() };
}

export type OfferState = { status: string; offerExpiresAt: string | null };
export type OfferAction = 'ok' | 'expired' | 'not_offered' | 'already_done';

/**
 * 繰り上げリンクを踏んだときに操作を受け付けてよいか。
 * 期限切れ・二重操作・未通知を分けて返し、画面で理由を出せるようにする。
 */
export function isOfferActionable(s: OfferState, nowIso: string): OfferAction {
  if (s.status === 'accepted' || s.status === 'declined') return 'already_done';
  if (s.status !== 'offered' || !s.offerExpiresAt) return 'not_offered';
  return s.offerExpiresAt > nowIso ? 'ok' : 'expired';
}

/** 期限を日本語で表示する(メール・画面共通)。 */
export function formatOfferDeadline(iso: string): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${w}) ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 公開エントリーリストに出すCTAの出し分け。
 *
 * リストはInstagramの固定リンク先で流入が多いのに、満枠でも「エントリーする」しか
 * 出しておらず、押した先で初めて満枠を知る導線だった(TARO 2026-08-30)。
 * 判定は canJoinWaitlist と同じものを使い、フォーム側と食い違わないようにする。
 */
export type EntryListCta = {
  kind: 'entry' | 'waitlist' | 'waitlist_full';
  href: string | null;
  isFull: boolean;
};

export function entryListCta({
  division,
  count,
  capacity,
  waiting,
}: {
  division: string;
  count: number;
  capacity: number;
  waiting: number;
}): EntryListCta {
  // 定員未設定(0)は満枠と区別がつかないので通常導線のままにする
  if (capacity <= 0) return { kind: 'entry', href: '/bf6/entry', isFull: false };
  const remaining = capacity - count;
  const gate = canJoinWaitlist({ remaining, waiting });
  if (gate === 'not_full') return { kind: 'entry', href: '/bf6/entry', isFull: false };
  if (gate === 'waitlist_full') return { kind: 'waitlist_full', href: null, isFull: true };
  return { kind: 'waitlist', href: `/bf6/waitlist?d=${division}`, isFull: true };
}

/**
 * 公開エントリーリストに載せるキャンセル待ち。
 *
 * 公開するのはエントリーリスト本体と同じ3項目(ダンサーネーム/ジャンル/レペゼン)だけ。
 * 本名・連絡先・学年は絶対に外へ出さない。
 * 'accepted' は出場が決まってエントリーリスト本体に載るので、ここには出さない。
 */
export type PublicWaitlistEntry = {
  order: number;
  dancerName: string;
  genre: string;
  rep: string;
};

const PUBLIC_WAITLIST_STATUSES = ['waiting', 'offered'];

export function publicWaitlistRows(
  rows: { position: number; status: string; dancerName: string; genre: string; rep: string }[]
): PublicWaitlistEntry[] {
  return rows
    .filter((r) => PUBLIC_WAITLIST_STATUSES.includes(r.status))
    .sort((a, b) => a.position - b.position)
    .map((r, i) => ({
      order: i + 1,
      dancerName: r.dancerName,
      genre: r.genre,
      rep: r.rep,
    }));
}

/**
 * タブに出す人数。キャンセル待ちを足して、定員を超えるくらい集まっていることを見せる
 * (16/16 → 17/16。TARO 2026-08-30「人気なのが分かりやすい方がいい」)。
 *
 * ⚠️ この数字は表示専用。満枠判定・CTAの出し分け(entryListCta)には絶対に渡さないこと。
 * 混ぜると、本体に空きがあるのにキャンセル待ち導線が出るなどの誤動作になる。
 */
export function displayedEntryCount({
  entryCount,
  waitingCount,
}: {
  entryCount: number;
  waitingCount: number;
}): number {
  return entryCount + waitingCount;
}
