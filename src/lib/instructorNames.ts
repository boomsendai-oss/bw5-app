// 講師欄(reel_draft.instructor)は1人とは限らない。
//   「K@TTSU / AOI」 … 2人担当のクラス(多賀城HOUSE)
//   「TARO & Ryuki」 … 合同ナンバー(GRAFFITI)
// 共同投稿もキャプションの講師行も、この全員を相手にする。
//
// ⚠️ 講師名に「@」が入る(K@TTSU)ので、区切り文字に @ を使わないこと。
//    以前この欄を単独名として扱っていたため、画面の共同投稿チェックは1人しか出せず、
//    多賀城HOUSEでAOIを共同投稿者にする手段が無かった(TARO 2026-09-21)。

/** 「K@TTSU / AOI」「TARO & Ryuki」→ ['K@TTSU','AOI'] / ['TARO','Ryuki'] */
export function splitInstructorNames(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[\/／&＆,，、]|\s+と\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type InstructorHandle = { name: string; handle: string | null };

/**
 * 講師名を登録簿(instructors)のハンドルに解決する。照合語彙は castSuggest/storyPlan と同じ
 * 「NFKC正規化 + 大文字化 + 完全一致→部分一致」。未登録は handle: null で返す
 * (画面側で「ハンドル未登録なので共同投稿に招待できない」と出すため、落とさず残す)。
 */
export function resolveInstructorHandles(
  raw: string | null | undefined,
  table: Array<{ name: string; handle: string | null }>
): InstructorHandle[] {
  const norm = (s: string) => s.normalize('NFKC').trim().toUpperCase();
  const idx = table
    .map((t) => ({ key: norm(t.name), handle: t.handle?.trim() || null }))
    .filter((t) => t.key.length > 0);

  const out: InstructorHandle[] = [];
  const seen = new Set<string>();
  for (const name of splitInstructorNames(raw)) {
    const who = norm(name);
    const hit = idx.find((t) => t.key === who) ?? idx.find((t) => t.key.includes(who) || who.includes(t.key));
    const handle = hit?.handle ?? null;
    // 同じハンドルを2回招待しない(表記ゆれで同一人物を2度書いた場合)
    if (handle && seen.has(handle)) continue;
    if (handle) seen.add(handle);
    out.push({ name, handle });
  }
  return out;
}
