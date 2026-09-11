// 受信箱アラート: 文字数の切り詰めとJST表示の小道具(純関数)。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 文字(コードポイント)単位の長さ。Pushoverの上限は文字数で数えるため */
export function charLength(s: string): number {
  return Array.from(s).length;
}

/** 上限を超えたら末尾を…にして、…込みで max 文字に収める */
export function truncateChars(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}

function jst(ms: number): Date {
  return new Date(ms + JST_OFFSET_MS);
}

/** 例: 9/12 */
export function jstMd(ms: number): string {
  const d = jst(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** 例: 07:55 */
export function jstHm(ms: number): string {
  const d = jst(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function jstDayNumber(ms: number): number {
  return Math.floor((ms + JST_OFFSET_MS) / 86_400_000);
}

/** 受信日時を「今日12:10 / 昨日12:10 / 9/10」で表す */
export function receivedLabel(receivedMs: number, nowMs: number): string {
  const diff = jstDayNumber(nowMs) - jstDayNumber(receivedMs);
  if (diff === 0) return `今日${jstHm(receivedMs)}`;
  if (diff === 1) return `昨日${jstHm(receivedMs)}`;
  return jstMd(receivedMs);
}
