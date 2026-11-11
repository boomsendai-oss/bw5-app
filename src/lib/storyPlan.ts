import { lessonMatches, judgeEntry, applySubstitutes, type SubstituteRecord, type Swap } from './storySubstitute';

// ストーリー素材の選択ロジック(cron本番と /staff/instagram の「明日の投稿予定」プレビューで共用)。
// 優先チェーン: ①日付指定 {YYYY-MM-DD}.(mp4|jpg) ②曜日 {曜日}.(mp4|jpg) ③埋め草キュー ④出さない。
// 同一優先度内は mp4 > jpg (静止画を先に置き、動画完成後に同名.mp4を置くだけで自動格上げ)。
// 設計: docs/decisions/2026-07-16_instagram-story-posting-time.md

export const WEEKDAY_FILES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type ChainMedia = {
  url: string;
  type: 'video' | 'image';
  base: string; // 'YYYY-MM-DD' または曜日名。メンションsidecar {base}.json の参照にも使う
  source: 'date-file' | 'weekday-file' | 'library-auto' | 'substitute';
  // library-auto / substitute の時だけ: 宣言/メンションを直接持つ。sidecar {base}.json は読まずこれを使う。
  // substitute = 代講版(M1が作ってR2に置いた画像。url は絶対URL・base は 'sub:{日付}:{元の素材}')。
  lessons?: DeclaredLesson[];
  mentions?: string[];
};

const MAX_SLOTS = 4; // 1日の最大連続投稿数(朝8:00にまとめて投稿)

/**
 * 日付指定→曜日の順で public/stories/ の素材を探す(HEADで実在確認)。
 * 1日複数本対応: {base}.jpg に加えて {base}-2.jpg, {base}-3.jpg... と連番で置くと
 * 朝8:00にその順で連続投稿される(例: 土曜の朝の部+午後の部)。連番は隙間なく詰める。
 * 優先度は日付指定tier全体 > 曜日tier全体(混在しない)。各スロット内は mp4 > jpg。
 */
export async function findChainMediaList(origin: string, date: string, weekday: number): Promise<ChainMedia[]> {
  const exts: Array<{ ext: string; type: ChainMedia['type'] }> = [
    { ext: 'mp4', type: 'video' },
    { ext: 'jpg', type: 'image' },
  ];
  const fileChain = async (base: string, source: ChainMedia['source']): Promise<ChainMedia[]> => {
    const list: ChainMedia[] = [];
    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const slotBase = slot === 1 ? base : `${base}-${slot}`;
      let found: ChainMedia | null = null;
      for (const { ext, type } of exts) {
        const url = `${origin}/stories/${slotBase}.${ext}`;
        const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
        if (head?.ok) {
          found = { url, type, base: slotBase, source };
          break;
        }
      }
      if (!found) break; // 連番が途切れたら終わり
      list.push(found);
    }
    return list;
  };

  // 優先度: ①日付指定(手動上書き) > ②ライブラリ自動選択(カレンダー突合) > ③曜日デフォルト。
  const dated = await fileChain(date, 'date-file');
  if (dated.length > 0) return sortByDeclaredTime(origin, dated);
  const auto = await selectLibraryChain(origin, date, weekday);
  const chain = auto.length > 0 ? auto : await fileChain(WEEKDAY_FILES[weekday], 'weekday-file');
  return sortByDeclaredTime(origin, await withSubstitutes(date, chain));
}

/** その日の代講版(story_substitute)を読む。表が無い・読めない時は空(=従来どおり)。 */
export async function loadSubstitutes(date: string): Promise<SubstituteRecord[]> {
  try {
    const { getAll } = await import('./db');
    const rows = await getAll(
      "SELECT replaces_base, media_url, lessons FROM story_substitute WHERE date = ? AND status = 'active' ORDER BY replaces_base",
      [date]
    );
    return rows
      .map((r) => ({
        replacesBase: String(r.replaces_base),
        mediaUrl: String(r.media_url),
        lessons: (() => {
          try {
            const v = JSON.parse(String(r.lessons));
            return Array.isArray(v) ? (v as DeclaredLesson[]) : [];
          } catch {
            return [];
          }
        })(),
      }))
      .filter((s) => s.lessons.length > 0);
  } catch {
    return [];
  }
}

// 代講版を通常のチェーンに差し込む(TARO 2026-11-11: 代講はいつもの画像を代講の形に作り変えて自動で出す)。
// 代講版も宣言レッスン(代講に入る講師)を持つので、投稿の直前にカレンダー照合を通る。
// 夜のうちに代講が取り消されれば照合で止まる(=古い代講版が出ることはない)。
async function withSubstitutes(date: string, chain: ChainMedia[]): Promise<ChainMedia[]> {
  const subs = await loadSubstitutes(date);
  if (subs.length === 0) return chain;
  return applySubstitutes(chain, subs, (s) => ({
    url: s.mediaUrl,
    type: 'image' as const,
    base: `sub:${date}:${s.replacesBase}`,
    source: 'substitute' as const,
    lessons: s.lessons,
    mentions: [],
  }));
}

export type SubstitutePlanItem = {
  base: string; // 元の素材(台帳のファイル名 or 曜日名)
  url: string; // 元の素材のURL
  lessons: DeclaredLesson[]; // 元の宣言
  swaps: Swap[];
  substitutedLessons: DeclaredLesson[]; // 代講版が宣言するレッスン
};

/**
 * 代講版を作るべき素材を洗い出す(M1の書き出しスクリプトが前夜に呼ぶ)。
 * 対象 = その日の台帳の画像(期間内)。台帳にその曜日の画像が1枚も無い時は曜日画像(wed.jpg等)。
 * 代講の印がある予定のせいで照合に落ちる画像のうち、食い違いが全部代講で説明できるものだけを返す。
 * 休講・時間変更などは others に理由だけ返す(今までどおり出さない)。
 */
export async function planSubstitutes(origin: string, date: string, weekday: number): Promise<{
  items: SubstitutePlanItem[];
  others: Array<{ base: string; problems: string[] }>;
  calendar: Array<{ start: string; end?: string; summary: string }>;
  calendarSource: 'api' | 'ics';
}> {
  const { fetchLessonsForDate } = await import('./lessonCalendar');
  const { getAll } = await import('./db');
  const { lessons: cal, source } = await fetchLessonsForDate(date);
  const knownNames = (await getAll('SELECT name FROM instructors')).map((r) => String(r.name));

  type Cand = { base: string; url: string; lessons: DeclaredLesson[] };
  let cands: Cand[] = [];
  try {
    const res = await fetch(`${origin}/stories/library/manifest.json`, { cache: 'no-store' });
    if (res.ok) {
      const manifest = (await res.json()) as { entries?: Array<LibraryEntryPeriod & { file: string; weekday: number; lessons: DeclaredLesson[] }> };
      cands = (manifest.entries ?? [])
        .filter((e) => e.weekday === weekday && e.lessons?.length && isEntryInPeriod(e, date))
        .map((e) => ({ base: e.file, url: `${origin}/stories/library/${encodeURIComponent(e.file)}`, lessons: e.lessons }));
    }
  } catch {
    cands = [];
  }
  if (cands.length === 0) {
    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const b = slot === 1 ? WEEKDAY_FILES[weekday] : `${WEEKDAY_FILES[weekday]}-${slot}`;
      const head = await fetch(`${origin}/stories/${b}.jpg`, { method: 'HEAD' }).catch(() => null);
      if (!head?.ok) break;
      const sc = await loadSidecar(origin, b);
      if (sc.lessons?.length) cands.push({ base: b, url: `${origin}/stories/${b}.jpg`, lessons: sc.lessons });
    }
  }

  const covered = new Set<string>();
  const subs: SubstitutePlanItem[] = [];
  const others: Array<{ base: string; problems: string[] }> = [];
  for (const c of cands) {
    const j = judgeEntry(cal, knownNames, c.lessons);
    if (j.kind === 'ok') c.lessons.forEach((d) => covered.add(lessonKey(d.start, d.instructor)));
    else if (j.kind === 'substitute') subs.push({ base: c.base, url: c.url, lessons: c.lessons, swaps: j.swaps, substitutedLessons: j.lessons });
    else others.push({ base: c.base, problems: j.problems });
  }
  // 台帳の自動選択と同じく、情報量の多い画像から選び、既に全部載っている画像は捨てる
  subs.sort((a, b) => b.lessons.length - a.lessons.length || a.base.localeCompare(b.base));
  const items: SubstitutePlanItem[] = [];
  for (const s of subs) {
    const keys = s.substitutedLessons.map((d) => lessonKey(d.start, d.instructor));
    if (keys.every((k) => covered.has(k))) continue;
    keys.forEach((k) => covered.add(k));
    items.push(s);
  }
  return { items, others, calendar: cal, calendarSource: source };
}

// 投稿順ルール(TARO 2026-07-25確定): チェーン内は「宣言時間が早いスロットから先に」投稿する。
// 時間の出どころ: lessons宣言の最小start(レッスン素材) / sidecarのtimeフィールド(イベント素材)。
// 時間が取れないスロットは末尾(元の連番順を維持)。
function earliestDeclaredTime(lessons?: DeclaredLesson[], time?: string): string | null {
  const starts = (lessons ?? []).map((l) => l.start.slice(0, 5)).filter(Boolean);
  if (time) starts.push(time);
  return starts.length > 0 ? starts.sort()[0] : null;
}

async function sortByDeclaredTime(origin: string, list: ChainMedia[]): Promise<ChainMedia[]> {
  if (list.length < 2) return list;
  const keyed = await Promise.all(
    list.map(async (m, i) => {
      // library-auto は台帳由来のlessonsを直接持つ。ファイル素材はsidecarから読む
      let lessons = m.lessons;
      let time: string | undefined;
      if (m.source !== 'library-auto' && m.source !== 'substitute') {
        const sc = await loadSidecar(origin, m.base);
        lessons = sc.lessons;
        time = sc.time;
      }
      return { m, i, t: earliestDeclaredTime(lessons, time) };
    })
  );
  keyed.sort((a, b) => {
    if (a.t && b.t && a.t !== b.t) return a.t < b.t ? -1 : 1;
    if (a.t && !b.t) return -1;
    if (!a.t && b.t) return 1;
    return a.i - b.i;
  });
  return keyed.map((k) => k.m);
}

// 台帳(library/manifest.json)の各画像を当日のカレンダー(正本)と突合し、内容が一致する画像を自動選択する。
// 週替わりの土日でも「その週の実際の顔ぶれ」に合う画像を自動で選んで並べる(手作業ゼロ化)。
// 一致画像が無いグループは投稿されない(=素材不足→watchdog/プレビューで可視化)。
export async function selectLibraryChain(origin: string, date: string, weekday: number): Promise<ChainMedia[]> {
  let manifest: { entries?: Array<LibraryEntryPeriod & { file: string; weekday: number; mentions?: string[]; lessons: DeclaredLesson[] }> };
  try {
    const res = await fetch(`${origin}/stories/library/manifest.json`, { cache: 'no-store' });
    if (!res?.ok) return [];
    manifest = await res.json();
  } catch {
    return [];
  }
  const entries = (manifest.entries ?? []).filter(
    (e) => e.weekday === weekday && e.lessons?.length && isEntryInPeriod(e, date)
  );
  if (entries.length === 0) return [];

  const { fetchLessonsForDate } = await import('./lessonCalendar');
  const { getAll } = await import('./db');
  let calLessons: Array<{ start: string; summary: string }>;
  try {
    ({ lessons: calLessons } = await fetchLessonsForDate(date));
  } catch {
    return []; // カレンダーが読めない時は自動選択しない(誤爆防止→曜日デフォルトへフォールバック)
  }
  const knownNames = (await getAll('SELECT name FROM instructors')).map((r) => String(r.name).toUpperCase());

  // 宣言レッスンが全部カレンダーに存在する画像だけ残す(checkScheduleと同じ照合規則)
  const matched = entries.filter((e) => e.lessons.every((d) => matchDeclaredLesson(calLessons, knownNames, d)));
  // カバーするレッスン数が多い順(情報量の多い画像を優先。例: サユキ単体よりサユキ+おっちゃん)
  matched.sort((a, b) => b.lessons.length - a.lessons.length || a.file.localeCompare(b.file));
  // 貪欲セットカバー: 既に全レッスンがカバー済みの画像(冗長)は捨てる
  const covered = new Set<string>();
  const chosen: typeof matched = [];
  for (const e of matched) {
    const keys = e.lessons.map((d) => lessonKey(d.start, d.instructor));
    if (keys.every((k) => covered.has(k))) continue;
    keys.forEach((k) => covered.add(k));
    chosen.push(e);
  }
  return chosen.slice(0, MAX_SLOTS).map((e) => ({
    url: `${origin}/stories/library/${encodeURIComponent(e.file)}`,
    type: 'image' as const,
    base: e.file,
    source: 'library-auto' as const,
    lessons: e.lessons,
    mentions: e.mentions ?? [],
  }));
}

/**
 * 台帳の各画像に「使ってよい期間」を持たせる(TARO 2026-11-06: 12/1からの新しい時間割)。
 * 照合は「時刻+講師名」だけなので、クラス名だけが変わる改編(例: 多賀城 HIPHOP 基礎→入門)や、
 * 開講前の体験会が同じ時刻にある週では新旧の画像を区別できない。from/until で切り替え日を明示する。
 * どちらも 'YYYY-MM-DD'(JST・両端含む)。省略 = 期限なし。純関数(テスト対象)。
 */
export type LibraryEntryPeriod = { from?: string; until?: string };

export function isEntryInPeriod(entry: LibraryEntryPeriod, date: string): boolean {
  if (entry.from && date < entry.from) return false;
  if (entry.until && date > entry.until) return false;
  return true;
}

function lessonKey(start: string, instructor: string): string {
  return `${start.slice(0, 5)}|${instructor.trim().toUpperCase()}`;
}

// 宣言レッスン1件が当日カレンダーに存在するか(checkScheduleの1件判定と同じ規則)。
export function matchDeclaredLesson(
  calLessons: Array<{ start: string; summary: string }>,
  knownNames: string[],
  d: DeclaredLesson
): boolean {
  const start = d.start.slice(0, 5);
  const atTime = calLessons.filter((l) => l.start === start);
  if (atTime.length === 0) return false;
  // 判定の本体は storySubstitute.lessonMatches(代講の判定と同じ規則を共有するため・2026-11-11)。
  // ・全角と半角の揺れは NFKC で吸収する(2026-09-12「多賀城HOUSE【K＠TTSU】」が一致せず未投稿になった)。
  // ・タイトルに講師名が無い予定は一致とみなさない(2026-08-08の誤配信: 11:00の「⚔️ダンスバトル練習会」
  //   だけで多賀城の2枚が「実在する」と判定された。BOOMのレッスン予定は必ず【講師名】が入る運用)。
  // ・代講の印(代講/代行)がある予定は「代講 ○○」の○○、無ければ【】の中の講師が教える人。
  //   「（代講）」「（代行）」だけを後ろに付けた書き方で、元の講師の画像が通ってしまわないようにする。
  return lessonMatches(atTime, knownNames, d);
}

/** 素材の宣言内容。「この素材は 18:30 AOI / 19:30 TARO の告知」をsidecarに書く */
export type DeclaredLesson = { start: string; instructor: string };

export type Sidecar = {
  mentions?: string[];
  lessons?: DeclaredLesson[];
  time?: string; // lessons宣言の無い素材(イベントフライヤー等)の開催時刻 HH:MM。投稿順の決定に使う
};

/**
 * sidecar {base}.json を読む。無ければ空オブジェクト。
 *   mentions: ストーリーにタグ付けするIGユーザー名(公開アカのみ。失敗時はcron側でメンション無し再試行)
 *   lessons:  素材が告知しているレッスン内容の宣言。あれば投稿前に正本スケジュールと照合される
 */
export async function loadSidecar(origin: string, base: string): Promise<Sidecar> {
  const res = await fetch(`${origin}/stories/${base}.json`).catch(() => null);
  if (!res?.ok) return {};
  const j = await res.json().catch(() => null);
  const out: Sidecar = {};
  if (Array.isArray(j?.mentions)) {
    const mentions = j.mentions.filter((m: unknown) => typeof m === 'string');
    if (mentions.length > 0) out.mentions = mentions;
  }
  if (Array.isArray(j?.lessons)) {
    const lessons = j.lessons.filter(
      (l: unknown): l is DeclaredLesson =>
        typeof l === 'object' && l !== null &&
        typeof (l as DeclaredLesson).start === 'string' &&
        typeof (l as DeclaredLesson).instructor === 'string'
    );
    if (lessons.length > 0) out.lessons = lessons;
  }
  if (typeof j?.time === 'string' && /^\d{1,2}:\d{2}/.test(j.time)) {
    out.time = j.time.slice(0, 5).padStart(5, '0');
  }
  return out;
}

/**
 * 講師名(宣言 or カレンダー由来) → IGハンドルを instructors マスタから解決する。
 * ハンドルの正本は instructors.instagram_handle 列(UIで編集可)。代講講師も1行登録すれば恒久解決。
 * これにより sidecar json の mentions を手管理する必要がなくなる(陳腐化の根絶)。
 * 大文字化して部分一致で照合(checkSchedule と同じ語彙)。未解決の講師名は unresolved に返す。
 */
export async function resolveMentions(
  instructorNames: string[]
): Promise<{ handles: string[]; unresolved: string[] }> {
  const { getAll } = await import('./db');
  const rows = await getAll('SELECT name, instagram_handle FROM instructors');
  const table = rows
    .map((r) => ({ name: String(r.name).trim().toUpperCase(), handle: (r.instagram_handle ? String(r.instagram_handle).trim() : '') }))
    .filter((r) => r.name.length > 0);

  const handles: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const raw of instructorNames) {
    const who = raw.trim().toUpperCase();
    if (!who) continue;
    const hit = table.find((t) => t.name === who) ?? table.find((t) => t.name.includes(who) || who.includes(t.name));
    if (hit && hit.handle) {
      if (!seen.has(hit.handle)) {
        seen.add(hit.handle);
        handles.push(hit.handle);
      }
    } else {
      unresolved.push(raw);
    }
  }
  return { handles, unresolved };
}

export type ScheduleCheck =
  | { result: 'no-declaration' } // 素材にlessons宣言なし=照合せずそのまま信頼
  | { result: 'check-error'; error: string } // 正本カレンダーが読めない(照合できないが投稿は止めない)
  | { result: 'match'; actual: string[] }
  | { result: 'mismatch'; actual: string[]; declared: string[]; problems: string[] };

/**
 * 素材の宣言内容を正本=BOOMのGoogleカレンダー(TAROが直接編集・最も新しい)と照合する。
 * 休講(イベント削除)・代講(タイトルに「代講 ○○」)・時間変更が入っていれば不一致になり、
 * 間違った告知の自動投稿を防ぐ(2026-07-16 TARO確定: 正本はDBではなくGカレンダー)。
 *
 * 判定は部分一致方式: 宣言した各レッスンが当日のカレンダーに存在すればOK。
 * (素材が載せていないレッスンがカレンダーにあっても不一致にはしない —
 *  朝/午後で素材を分ける・スタジオ別素材などを許容するため)
 *   1. 宣言の開始時刻に一致するイベントが無い → 不一致(時間変更 or 休講)
 *   2. イベントタイトルに「代講」があり、代講講師 ≠ 宣言講師 → 不一致
 *   3. タイトルに講師名が書かれていて宣言講師が含まれない → 不一致
 *   4. タイトルに講師名が無い(例:「ハウスエキスパートクラス」) → 時刻一致でOK
 */
export async function checkSchedule(date: string, declared: DeclaredLesson[] | undefined): Promise<ScheduleCheck> {
  if (!declared || declared.length === 0) return { result: 'no-declaration' };

  const { fetchLessonsForDate } = await import('./lessonCalendar');
  const { getAll } = await import('./db');
  let lessons;
  try {
    ({ lessons } = await fetchLessonsForDate(date));
  } catch (e) {
    return { result: 'check-error', error: e instanceof Error ? e.message : String(e) };
  }

  // 講師名の照合語彙(タイトル内の講師検出に使う)。DB登録名+表記ゆれはUPPERCASE比較。
  const instructorRows = await getAll('SELECT name FROM instructors');
  const knownNames = instructorRows.map((r) => String(r.name).toUpperCase());

  const actual = lessons.map((l) => `${l.start} ${l.summary}`);
  const problems: string[] = [];

  for (const d of declared) {
    const start = d.start.slice(0, 5);
    const who = d.instructor.trim().toUpperCase();
    const atTime = lessons.filter((l) => l.start === start);
    if (atTime.length === 0) {
      problems.push(`${start} のレッスンがカレンダーに無い(宣言: ${d.instructor})`);
      continue;
    }
    // 照合規則は matchDeclaredLesson が正本。ここで規則を書き写すと、
    // 投稿側(selectLibraryChain)と検査側(前夜プリフライト/watchdog)で規則がズレて
    // 「誤配信を検査もすり抜ける」状態になる(2026-08-08の誤配信がまさにそれ)。
    const ok = matchDeclaredLesson(atTime, knownNames, d);
    if (!ok) {
      problems.push(`${start} ${d.instructor} がカレンダーと不一致(実際: ${atTime.map((l) => l.summary).join(' / ')})`);
    }
  }

  const declaredKeys = declared.map((d) => `${d.start.slice(0, 5)} ${d.instructor}`);
  return problems.length === 0
    ? { result: 'match', actual }
    : { result: 'mismatch', actual, declared: declaredKeys, problems };
}
