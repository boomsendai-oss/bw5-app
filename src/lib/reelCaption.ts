/**
 * キャプション内の「CAST : @… 」行の差し替え。
 * CASTはアプリで後から足したり消したりする(受講者は毎回違う)。キャプション本文を
 * 手で書き換えさせると事故るので、CAST行だけを機械的に入れ替える。
 *
 * 置き場所のルール(発表会リールの正本文面に合わせる):
 *   … 📍/🕺の行 … / 空行 / CAST : @a @b / 空行 / 体験レッスンは無料… / 空行 / #タグ
 * 既にCAST行があれば置き換え、無ければ「体験…」の直前(無ければタグ行の直前、それも
 * 無ければ末尾)に空行付きで差し込む。
 */
const CAST_PREFIX = 'CAST : ';

/** 「@」有無・区切り文字ゆれを吸収して、@付きハンドルの配列にする。 */
export function normalizeCastHandles(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[\s,、，]+/)
    .map((s) => s.replace(/^@+/, '').trim())
    .filter(Boolean);
}

export function upsertCastLine(caption: string, rawHandles: string | null | undefined): string {
  const handles = normalizeCastHandles(rawHandles);
  const lines = String(caption ?? '').split('\n');

  // 既存のCAST行(と、その直前の空行)を取り除く
  const castIdx = lines.findIndex((l) => l.startsWith(CAST_PREFIX));
  if (castIdx >= 0) {
    const from = castIdx > 0 && lines[castIdx - 1].trim() === '' ? castIdx - 1 : castIdx;
    lines.splice(from, castIdx - from + 1);
  }
  if (handles.length === 0) return lines.join('\n');

  const castLine = CAST_PREFIX + handles.map((h) => `@${h}`).join(' ');
  let at = lines.findIndex((l) => l.startsWith('体験'));
  if (at < 0) at = lines.findIndex((l) => l.trimStart().startsWith('#'));
  if (at < 0) {
    // 置き場所が見つからない自由文面は末尾に足す
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(castLine);
    return lines.join('\n');
  }
  // 「体験…」やタグ行の直前に、空行を挟んで入れる
  const before = at > 0 && lines[at - 1].trim() === '' ? at - 1 : at;
  lines.splice(before, 0, '', castLine);
  return lines.join('\n');
}
