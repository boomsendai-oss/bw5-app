// ストーリー素材の選択ロジック(cron本番と /staff/instagram の「明日の投稿予定」プレビューで共用)。
// 優先チェーン: ①日付指定 {YYYY-MM-DD}.(mp4|jpg) ②曜日 {曜日}.(mp4|jpg) ③埋め草キュー ④出さない。
// 同一優先度内は mp4 > jpg (静止画を先に置き、動画完成後に同名.mp4を置くだけで自動格上げ)。
// 設計: docs/decisions/2026-07-16_instagram-story-posting-time.md

export const WEEKDAY_FILES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export type ChainMedia = {
  url: string;
  type: 'video' | 'image';
  base: string; // 'YYYY-MM-DD' または曜日名。メンションsidecar {base}.json の参照にも使う
  source: 'date-file' | 'weekday-file';
};

/** 日付指定→曜日の順で public/stories/ の素材を探す(HEADで実在確認)。無ければnull。 */
export async function findChainMedia(origin: string, date: string, weekday: number): Promise<ChainMedia | null> {
  const tiers: Array<{ base: string; source: ChainMedia['source'] }> = [
    { base: date, source: 'date-file' },
    { base: WEEKDAY_FILES[weekday], source: 'weekday-file' },
  ];
  const exts: Array<{ ext: string; type: ChainMedia['type'] }> = [
    { ext: 'mp4', type: 'video' },
    { ext: 'jpg', type: 'image' },
  ];
  for (const { base, source } of tiers) {
    for (const { ext, type } of exts) {
      const url = `${origin}/stories/${base}.${ext}`;
      const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (head?.ok) return { url, type, base, source };
    }
  }
  return null;
}

/** 素材の宣言内容。「この素材は 18:30 AOI / 19:30 TARO の告知」をsidecarに書く */
export type DeclaredLesson = { start: string; instructor: string };

export type Sidecar = {
  mentions?: string[];
  lessons?: DeclaredLesson[];
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
  return out;
}

export type ScheduleCheck =
  | { result: 'no-declaration' } // 素材にlessons宣言なし=照合せずそのまま信頼
  | { result: 'match'; actual: string[] }
  | { result: 'mismatch'; actual: string[]; declared: string[] };

const lessonKey = (start: string, instructor: string) =>
  `${start.slice(0, 5)} ${instructor.trim().toUpperCase()}`;

/**
 * 素材の宣言内容を正本スケジュール(lesson_master+lesson_instances=Gカレの生成元)と照合する。
 * 休講・代講・時間変更が正本に入っていれば不一致になり、間違った告知の自動投稿を防ぐ。
 * 比較キーは (開始時刻, 講師名) の完全一致セット。
 */
export async function checkSchedule(date: string, declared: DeclaredLesson[] | undefined): Promise<ScheduleCheck> {
  if (!declared || declared.length === 0) return { result: 'no-declaration' };

  // その日を含む月の正本を展開して当日分に絞る(cronは1日1回なのでコストは許容)
  const { buildLessonsForMonths } = await import('./scheduleExport');
  const monthLessons = await buildLessonsForMonths(1, date.slice(0, 7));
  const actual = monthLessons
    .filter((l) => l.date === date && l.status === 'scheduled')
    .map((l) => lessonKey(l.start_time, l.instructor_name ?? '?'))
    .sort();

  const declaredKeys = declared.map((d) => lessonKey(d.start, d.instructor)).sort();
  const same = actual.length === declaredKeys.length && actual.every((k, i) => k === declaredKeys[i]);
  return same ? { result: 'match', actual } : { result: 'mismatch', actual, declared: declaredKeys };
}
