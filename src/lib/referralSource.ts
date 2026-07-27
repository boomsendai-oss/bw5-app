// src/lib/referralSource.ts — 流入経路(自己申告)の正規化 (WS AA / 2026-07-27)
//
// Lstepの選択肢を改訂しても過去データを捨てないよう、旧選択肢と新選択肢の
// 両方を同じ経路に寄せる。
//
// 「広告経由かどうか」はここでは判定しない。一般のお客さんはスポンサー表示を
// 見ても広告と自然検索の区別を認識しておらず、自己申告では正確に取れないため。
// 広告経由の判定はLstepの流入経路タグとGA4(sessionSourceMedium)が担当する。

export const REFERRAL_CHANNELS = [
  '紹介',
  'ネット検索',
  'マップ',
  'インスタ',
  'チラシ・看板',
  'その他',
  '未記入',
] as const;

export type ReferralChannel = (typeof REFERRAL_CHANNELS)[number];

export function normalizeReferral(raw: string | null | undefined): ReferralChannel {
  const s = (raw ?? '').trim();
  if (!s) return '未記入';
  // マップは「Google」を含むため検索より先に判定する
  if (/マップ|map/i.test(s)) return 'マップ';
  if (/紹介|口コミ|くちこみ/.test(s)) return '紹介';
  if (/インスタ|instagram|\big\b/i.test(s)) return 'インスタ';
  if (/検索|google|グーグル|yahoo|ヤフー|ネット|web/i.test(s)) return 'ネット検索';
  if (/チラシ|看板|ポスティング|新聞/.test(s)) return 'チラシ・看板';
  return 'その他';
}
