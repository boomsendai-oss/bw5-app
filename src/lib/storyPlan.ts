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

const MAX_SLOTS = 4; // 1日の最大連続投稿数(朝8:00にまとめて投稿)

/**
 * 日付指定→曜日の順で public/stories/ の素材を探す(HEADで実在確認)。
 * 1日複数本対応: {base}.jpg に加えて {base}-2.jpg, {base}-3.jpg... と連番で置くと
 * 朝8:00にその順で連続投稿される(例: 土曜の朝の部+午後の部)。連番は隙間なく詰める。
 * 優先度は日付指定tier全体 > 曜日tier全体(混在しない)。各スロット内は mp4 > jpg。
 */
export async function findChainMediaList(origin: string, date: string, weekday: number): Promise<ChainMedia[]> {
  const tiers: Array<{ base: string; source: ChainMedia['source'] }> = [
    { base: date, source: 'date-file' },
    { base: WEEKDAY_FILES[weekday], source: 'weekday-file' },
  ];
  const exts: Array<{ ext: string; type: ChainMedia['type'] }> = [
    { ext: 'mp4', type: 'video' },
    { ext: 'jpg', type: 'image' },
  ];
  for (const { base, source } of tiers) {
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
    if (list.length > 0) return list;
  }
  return [];
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
    const ok = atTime.some((l) => {
      const title = l.summary.toUpperCase();
      const daiko = l.summary.match(/代講[\s:：]*([^\s　]+)/);
      if (daiko) return daiko[1].toUpperCase().includes(who) || who.includes(daiko[1].toUpperCase());
      const namesInTitle = knownNames.filter((n) => title.includes(n));
      if (namesInTitle.length === 0) return true; // タイトルに講師名なし→時刻一致でOK
      return namesInTitle.includes(who);
    });
    if (!ok) {
      problems.push(`${start} ${d.instructor} がカレンダーと不一致(実際: ${atTime.map((l) => l.summary).join(' / ')})`);
    }
  }

  const declaredKeys = declared.map((d) => `${d.start.slice(0, 5)} ${d.instructor}`);
  return problems.length === 0
    ? { result: 'match', actual }
    : { result: 'mismatch', actual, declared: declaredKeys, problems };
}
