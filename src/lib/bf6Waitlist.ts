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
