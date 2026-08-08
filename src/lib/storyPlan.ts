// ストーリー素材の選択ロジック(cron本番と /staff/instagram の「明日の投稿予定」プレビューで共用)。
// 優先チェーン: ①日付指定 {YYYY-MM-DD}.(mp4|jpg) ②曜日 {曜日}.(mp4|jpg) ③埋め草キュー ④出さない。
// 同一優先度内は mp4 > jpg (静止画を先に置き、動画完成後に同名.mp4を置くだけで自動格上げ)。
// 設計: docs/decisions/2026-07-16_instagram-story-posting-time.md

export const WEEKDAY_FILES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type ChainMedia = {
  url: string;
  type: 'video' | 'image';
  base: string; // 'YYYY-MM-DD' または曜日名。メンションsidecar {base}.json の参照にも使う
  source: 'date-file' | 'weekday-file' | 'library-auto';
  // library-auto の時だけ: 台帳(manifest)由来の宣言/メンション。sidecar {base}.json は読まずこれを使う。
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
  if (auto.length > 0) return sortByDeclaredTime(origin, auto);
  return sortByDeclaredTime(origin, await fileChain(WEEKDAY_FILES[weekday], 'weekday-file'));
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
      if (m.source !== 'library-auto') {
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
  let manifest: { entries?: Array<{ file: string; weekday: number; mentions?: string[]; lessons: DeclaredLesson[] }> };
  try {
    const res = await fetch(`${origin}/stories/library/manifest.json`, { cache: 'no-store' });
    if (!res?.ok) return [];
    manifest = await res.json();
  } catch {
    return [];
  }
  const entries = (manifest.entries ?? []).filter((e) => e.weekday === weekday && e.lessons?.length);
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
  const who = d.instructor.trim().toUpperCase();
  const atTime = calLessons.filter((l) => l.start === start);
  if (atTime.length === 0) return false;
  return atTime.some((l) => {
    const title = l.summary.toUpperCase();
    const daiko = l.summary.match(/代講[\s:：]*([^\s　]+)/);
    if (daiko) return daiko[1].toUpperCase().includes(who) || who.includes(daiko[1].toUpperCase());
    // タイトルに講師名が無い予定は「レッスンである保証が無い」ので一致とみなさない。
    // ⚠️2026-08-08の誤配信: 当日11:00にあったのは「⚔️ダンスバトル練習会」だけだったのに、
    //   旧実装は「講師名なし→時刻一致でOK」としていたため、多賀城AOI/多賀城KATTSUの2枚が
    //   "カレンダーに実在する"と誤判定され、休みの多賀城クラスの告知が自動投稿された。
    //   BOOMのレッスン予定は必ずタイトルに講師名が入る運用(【講師名】クラス名)なので、
    //   名前が取れない予定は落として良い(=誤配信より未投稿を選ぶ)。
    return knownNames.filter((n) => title.includes(n)).includes(who);
  });
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
