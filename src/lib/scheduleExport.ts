import { randomBytes } from 'crypto';
import { getAll, getOne, execute } from './db';
import { getConfirmedMonthsSet } from './monthConfirm';

// ============================================
// マスタースケジュール エクスポート共通ロジック
// ICS (Googleカレンダー) / CSV (HACOMONO・Lstep素材) で共有する
//
// /api/staff/schedule/calendar のロジックを「複数月・フラットなレッスン配列」に
// 拡張したもの。lesson_master(週次パターン) + lesson_instances(実開催/休講) を合成。
// ============================================

export type ExportLesson = {
  date: string; // YYYY-MM-DD
  day_of_week: number; // 0=日 ... 6=土
  start_time: string; // HH:MM(:SS)
  end_time: string;
  class_name: string;
  instructor_name: string | null;
  studio_name: string | null;
  status: 'scheduled' | 'cancelled';
  source: 'instance' | 'master';
  master_id: number | null;
  instance_id: number | null;
  duration_minutes: number | null;
  frequency_type: string | null;
  notes: string | null;
};

type InstanceRow = {
  id: number;
  master_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  studio_id: number | null;
  instructor_id: number | null;
  status: string;
  notes: string | null;
  master_class_name: string | null;
  studio_name: string | null;
  instructor_name: string | null;
};

type MasterRow = {
  id: number;
  class_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  frequency_type: string | null;
  studio_name: string | null;
  instructor_name: string | null;
};

const pad = (n: number) => String(n).padStart(2, '0');
const dateStr = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * 今月初日から months ヶ月分の月末日まで(両端含む)のレッスンを
 * フラットな配列で返す。日付・時刻昇順。
 *
 * - 休講(status='cancelled')インスタンスも `status:'cancelled'` で含めて返す
 *   (ICSは STATUS:CANCELLED、CSVは「休講」として扱う。除外は呼び出し側の責務)
 * - master展開は該当インスタンスが既にある日付ではスキップ (重複防止)
 */
export async function buildLessonsForMonths(months: number): Promise<ExportLesson[]> {
  const safeMonths = Math.max(1, Math.min(24, Math.floor(months) || 1));
  const now = new Date();
  const baseYear = now.getFullYear();
  const baseMonth = now.getMonth() + 1; // 1-12

  // 期間 (今月初日 〜 (baseMonth + months - 1) の月末日)
  const startStr = dateStr(baseYear, baseMonth, 1);
  const endDateObj = new Date(baseYear, baseMonth - 1 + safeMonths, 0); // 末月の月末
  const endStr = dateStr(endDateObj.getFullYear(), endDateObj.getMonth() + 1, endDateObj.getDate());

  const instances = (await getAll(
    `SELECT li.*, lm.class_name AS master_class_name, s.name AS studio_name, i.name AS instructor_name
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     LEFT JOIN studios s ON s.id = li.studio_id
     LEFT JOIN instructors i ON i.id = li.instructor_id
     WHERE li.date BETWEEN ? AND ?
     ORDER BY li.date, li.start_time`,
    [startStr, endStr]
  )) as InstanceRow[];

  const masters = (await getAll(
    `SELECT lm.id, lm.class_name, lm.default_day_of_week AS day_of_week, lm.default_start_time AS start_time,
            lm.default_end_time AS end_time, lm.duration_minutes, lm.frequency_type,
            s.name AS studio_name, i.name AS instructor_name
     FROM lesson_master lm
     LEFT JOIN studios s ON s.id = lm.default_studio_id
     LEFT JOIN instructors i ON i.id = lm.default_instructor_id
     WHERE lm.active = 1`
  )) as MasterRow[];

  const lessons: ExportLesson[] = [];

  // 確定(凍結)済み月では master 週次展開をスキップ (instance スナップショットのみ)
  const confirmedMonths = await getConfirmedMonthsSet();

  // 期間内の各日を走査
  const cursor = new Date(baseYear, baseMonth - 1, 1);
  const last = new Date(endDateObj.getFullYear(), endDateObj.getMonth(), endDateObj.getDate());
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const d = cursor.getDate();
    const ds = dateStr(y, m, d);
    const dow = cursor.getDay();

    // a) インスタンス (実開催/休講)
    const dayInstances = instances.filter(i => i.date.startsWith(ds));
    for (const ins of dayInstances) {
      // status='removed' は「そもそも無かった」扱い → エクスポート(ICS/CSV/HACOMONO)に出さない。
      // (alreadyExpanded 判定は dayInstances 全件を使うので master 週次再展開は抑止される)
      if (ins.status === 'removed') continue;
      lessons.push({
        date: ds,
        day_of_week: dow,
        start_time: ins.start_time,
        end_time: ins.end_time,
        class_name: ins.master_class_name ?? '不明',
        instructor_name: ins.instructor_name,
        studio_name: ins.studio_name,
        status: ins.status === 'cancelled' ? 'cancelled' : 'scheduled',
        source: 'instance',
        master_id: ins.master_id,
        instance_id: ins.id,
        duration_minutes: durationFromTimes(ins.start_time, ins.end_time),
        frequency_type: null,
        notes: ins.notes,
      });
    }

    // b) master展開 (該当日に同masterのinstanceが無い場合のみ)
    // 確定(凍結)済み月は master 展開しない
    const ymOfDay = ds.slice(0, 7); // 'YYYY-MM'
    for (const mas of confirmedMonths.has(ymOfDay) ? [] : masters) {
      if (mas.day_of_week !== dow) continue;
      const alreadyExpanded = dayInstances.some(i => i.master_id === mas.id);
      if (alreadyExpanded) continue;
      lessons.push({
        date: ds,
        day_of_week: dow,
        start_time: mas.start_time,
        end_time: mas.end_time,
        class_name: mas.class_name,
        instructor_name: mas.instructor_name,
        studio_name: mas.studio_name,
        status: 'scheduled',
        source: 'master',
        master_id: mas.id,
        instance_id: null,
        duration_minutes: mas.duration_minutes ?? durationFromTimes(mas.start_time, mas.end_time),
        frequency_type: mas.frequency_type,
        notes: null,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  lessons.sort((a, b) =>
    a.date !== b.date ? a.date.localeCompare(b.date) : (a.start_time ?? '').localeCompare(b.start_time ?? '')
  );

  return lessons;
}

/** "HH:MM"/"HH:MM:SS" 2つから所要分を算出 (不正なら null) */
export function durationFromTimes(start: string | null, end: string | null): number | null {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s == null || e == null) return null;
  const diff = e - s;
  return diff > 0 ? diff : null;
}

/** "HH:MM"/"HH:MM:SS" を分(int)に。不正なら null */
function parseHHMM(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ============================================
// ICS購読トークン (settingsテーブルに保存)
// ICS購読はGoogleがCookieなしでGETするため、URLクエリ ?token=xxx で認証する。
// isAuthorized(管理パスワード)とは別系統。
// ============================================

export const ICS_EXPORT_TOKEN_KEY = 'ics_export_token';

/** 既存トークンを返す。無ければ生成して保存。 */
export async function getOrCreateIcsExportToken(): Promise<string> {
  const row = await getOne('SELECT value FROM settings WHERE key = ?', [ICS_EXPORT_TOKEN_KEY]);
  const existing = (row?.value as string | undefined) ?? '';
  if (existing) return existing;
  const token = generateToken();
  await execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [ICS_EXPORT_TOKEN_KEY, token]);
  return token;
}

function generateToken(): string {
  // 英数字32文字 (URLセーフ)。
  return randomBytes(24).toString('base64url').slice(0, 32);
}
