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

  // ① 既存のCAST行を、前後にくっついた空行ごと取り除いて「元の文面」に戻す。
  //    片側だけ消すと、入れ直すたびに空行が増えていく。
  const castIdx = lines.findIndex((l) => l.startsWith(CAST_PREFIX));
  if (castIdx >= 0) {
    let from = castIdx;
    let to = castIdx;
    while (from > 0 && lines[from - 1].trim() === '') from--;
    while (to < lines.length - 1 && lines[to + 1].trim() === '') to++;
    // 取り除いた跡は、前後に本文がある時だけ空行1つでつなぐ
    const joiner = from > 0 && to < lines.length - 1 ? [''] : [];
    lines.splice(from, to - from + 1, ...joiner);
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
  // ② 「体験…」やタグ行の直前へ。既にある空行は飲み込んで、上下を空行1つずつで挟む。
  let before = at;
  while (before > 0 && lines[before - 1].trim() === '') before--;
  lines.splice(before, at - before, '', castLine, '');
  return lines.join('\n');
}
