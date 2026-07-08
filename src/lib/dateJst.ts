// JST基準の日付ユーティリティ（PR-1 / 技術的負債改修設計 2026-07-06）。
// 日付は常に 'YYYY-MM-DD' 文字列・JST基準で扱い、Dateオブジェクトを外に漏らさない。
// 現状は各所で `new Date().toISOString().slice(0,10)`(=UTC)を直書きしており、
// JSTの朝9時前の操作が1日前倒しになる事故(M8/M9/M10/M11)の温床になっている。
// このモジュールに集約し、Phase 2で各消費側を順次移行する。
//
// 使い分け:
//   - 「日付としての判定」(今日/締切/基準日) → todayJst()
//   - 「いつ起きたかの記録」(通知日時・監査ログ) → nowUtcIso()
//     ※ 既存行(withdrawal_notices.notified_at 等)はUTC ISO(Z付き)なので、
//       書式混在による辞書順比較の汚染を避けるため記録もUTC ISOに合わせる。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 今日の日付(JST) 'YYYY-MM-DD'。now を渡せばテスト可能。 */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 記録用タイムスタンプ(UTC ISO・Z付き)。既存カラムの書式に合わせる。 */
export function nowUtcIso(now: Date = new Date()): string {
  return now.toISOString();
}

/**
 * 'YYYY-MM-DD' を N ヶ月ずらす（月末クランプ版）。
 * 1/31 +1M → 2/28、8/31 +6M → 2/28。膨張ロールオーバー(3/3等)しない。
 */
export function shiftMonthsClamped(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  // 目標月の1日を基準に、年跨ぎ・月インデックスを正規化する
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = first.getUTCFullYear();
  const tm = first.getUTCMonth(); // 0-based
  // 目標月の末日 = 翌月0日
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(ty, tm, day)).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' を N 日ずらす。 */
export function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' 厳格検証（実在日チェック込み: '2026-02-30' '2026-7-5' '2026/08/01' を拒否）。 */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 'YYYY-MM' 検証。 */
export function isYearMonth(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** 'HH:MM' / 'HH:MM:SS' 検証。 */
export function isHhmm(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return false;
  const [h, mi] = s.split(':').map(Number);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}
