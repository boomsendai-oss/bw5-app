// 代講(いつもの講師の代わりに別の講師が教える回)の判定。純関数のみ(テスト対象)。
//
// 毎日のストーリーは、曜日の画像が宣言する「時刻+講師」を正本カレンダーと照らし合わせ、
// 合わない日は出さない(post-story の skipped_schedule_mismatch)。代講の日はこれで止まるだけだったが、
// TARO決定(2026-11-11)で「代講は、いつもの画像を代講の形に作り変えて自動で出す」ことになった。
// ここでは「食い違いが全部、代講で説明できるか」と「誰から誰へ替わったか」を決める。
// 画像の書き出しは M1 の boom-events-hub/scripts/story_substitute が行う。
//
// カレンダーの代講の書き方は3通りある(どれも実在):
//   ① 【TARO】キッズHIPHOP 代講 KOKEKO   … 「代講」の後ろが教える人
//   ② 【AOI】hiphop 入門初級（代行）      … 【】の中が教える人(TAROは「代行」と書くことがある)
//   ③ 題名は【AOI】HOUSE 初級 のまま、説明欄に「K@TTSUの代行でAOIが担当」… 【】の中が教える人(2026-11-25)

export type CalLesson = { start: string; end?: string | null; summary: string; note?: string | null };
export type DeclaredLessonLike = { start: string; instructor: string };

export const norm = (v: string) => v.normalize('NFKC').trim().toUpperCase();

const MARK = /代講|代行/;

/** タイトルに出てくる講師名(登録名)。短い名前が長い名前の一部なだけなら除く(例: MY と MYU) */
export function namesInTitle(title: string, knownNames: string[]): string[] {
  const t = norm(title);
  const hits = [...new Set(knownNames.map(norm).filter((n) => n && t.includes(n)))];
  return hits.filter((n) => !hits.some((m) => m !== n && m.includes(n)));
}

/**
 * その予定で実際に教える講師。
 *   marked=false … 代講の印が無い予定。教える人は「タイトルに出てくる講師名」(従来どおり)
 *   marked=true  … 代講/代行の印がある予定。①「代講 ○○」の○○ → ②【】の中 → ③タイトルの講師名 の順で決める
 */
export function teachersOf(
  summary: string,
  knownNames: string[],
  note?: string | null
): { marked: boolean; teachers: string[] } {
  if (!MARK.test(summary) && !MARK.test(note ?? '')) return { marked: false, teachers: namesInTitle(summary, knownNames) };
  const after = summary.match(/(?:代講|代行)[\s:：]*([^\s　（）()【】]+)/);
  if (after) {
    const hit = namesInTitle(after[1], knownNames);
    if (hit.length > 0) return { marked: true, teachers: hit };
  }
  const bracket = summary.match(/【([^】]+)】/);
  if (bracket) {
    const hit = namesInTitle(bracket[1], knownNames);
    if (hit.length > 0) return { marked: true, teachers: hit };
  }
  return { marked: true, teachers: namesInTitle(summary, knownNames) };
}

/** 宣言レッスン1件がカレンダーのどれかの予定と一致するか(atTime は同じ時刻の予定だけを渡す) */
export function lessonMatches(atTime: CalLesson[], knownNames: string[], d: DeclaredLessonLike): boolean {
  const who = norm(d.instructor);
  return atTime.some((l) => teachersOf(l.summary, knownNames, l.note).teachers.includes(who));
}

export type Swap = { start: string; from: string; to: string; end: string | null; summary: string };

export type EntryJudgement =
  | { kind: 'ok' }
  | { kind: 'substitute'; swaps: Swap[]; lessons: DeclaredLessonLike[] }
  | { kind: 'other'; problems: string[] };

/**
 * 画像1枚の宣言レッスンをその日のカレンダーと照らす。
 *   ok         … そのまま出せる(代講なし)
 *   substitute … 食い違いが全部「同じ時刻の、代講の印がある予定で、別の講師1人が教える」で説明できる
 *   other      … 休講・時間変更・講師が決められない など(今までどおり止めるだけ)
 */
export function judgeEntry(cal: CalLesson[], knownNames: string[], declared: DeclaredLessonLike[]): EntryJudgement {
  const swaps: Swap[] = [];
  const problems: string[] = [];
  const lessons: DeclaredLessonLike[] = [];
  for (const d of declared) {
    const start = d.start.slice(0, 5);
    const atTime = cal.filter((l) => l.start === start);
    if (atTime.length === 0) {
      problems.push(`${start} のレッスンがカレンダーに無い(宣言: ${d.instructor})`);
      continue;
    }
    if (lessonMatches(atTime, knownNames, d)) {
      lessons.push({ start, instructor: d.instructor });
      continue;
    }
    const from = norm(d.instructor);
    const cands = atTime
      .map((l) => ({ l, t: teachersOf(l.summary, knownNames, l.note) }))
      .filter((x) => x.t.marked)
      .map((x) => ({ l: x.l, to: x.t.teachers.filter((n) => n !== from) }))
      .filter((x) => x.to.length === 1);
    if (cands.length !== 1) {
      problems.push(
        cands.length === 0
          ? `${start} ${d.instructor} がカレンダーと不一致(代講の印なし・実際: ${atTime.map((l) => l.summary).join(' / ')})`
          : `${start} 代講の予定が複数あり、どれか決められない`
      );
      continue;
    }
    const { l, to } = cands[0];
    swaps.push({ start, from: d.instructor, to: to[0], end: l.end ?? null, summary: l.summary });
    lessons.push({ start, instructor: to[0] });
  }
  if (problems.length > 0) return { kind: 'other', problems };
  if (swaps.length === 0) return { kind: 'ok' };
  return { kind: 'substitute', swaps, lessons };
}

export type SubstituteRecord = { replacesBase: string; mediaUrl: string; lessons: DeclaredLessonLike[] };

/**
 * 通常の投稿チェーンに代講版を差し込む。同じ素材(base)がチェーンにあれば置き換え、
 * 無ければ足す(台帳の自動選択は不一致の画像をそもそも選ばないので、足す形になる)。
 */
export function applySubstitutes<
  T extends { base: string; url: string; type: 'image' | 'video'; source: string; lessons?: DeclaredLessonLike[]; mentions?: string[] },
>(list: T[], subs: SubstituteRecord[], make: (s: SubstituteRecord) => T): T[] {
  const out = [...list];
  for (const s of subs) {
    const item = make(s);
    const i = out.findIndex((m) => m.base === s.replacesBase);
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out;
}

/** 代講版の置き場として受け付けるURL(R2の公開ドメインのみ。外部URLを投げ込ませない) */
export function isAllowedSubstituteUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'media.boom-sendai.com' && /\.(jpe?g|png)$/i.test(x.pathname);
  } catch {
    return false;
  }
}
