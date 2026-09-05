import { randomBytes } from 'crypto';
import { getAll, getOne, execute } from './db';
import { todayJst } from './dateJst';
import { getConfirmedMonthsSet } from './monthConfirm';
import {
  buildExpandedKeys,
  expandMasterSlotsRange,
  isMasterOutOfRange,
} from './lessonResolver';

// ============================================
// マスタースケジュール エクスポート共通ロジック
// ICS (Googleカレンダー) / CSV (HACOMONO・Lstep素材) で共有する
//
// /api/staff/schedule/calendar のロジックを「複数月・フラットなレッスン配列」に
// 拡張したもの。lesson_master(週次パターン) + lesson_instances(実開催/休講) を合成。
// ============================================


/**
 * インスタンスのクラス名を決める。
 * マスター紐付けがある通常回はマスター名。単発(master_id=null)はカレンダー取込時に
 * notes へ「単発: <クラス名>」と書かれるので、そこから名前を取る。
 * 以前は '不明' を出していたため、公開カレンダーとX投稿に「【TARO】不明」が出ていた(2026-09-05修正)。
 */
export function instanceClassLabel(masterClassName: string | null | undefined, notes: string | null | undefined): string {
  if (masterClassName && masterClassName.trim()) return masterClassName.trim();
  const n = (notes ?? '').trim();
  const m = n.match(/^単発\s*[:：]\s*(.+)$/u);
  if (m && m[1].trim()) return m[1].trim();
  return '特別レッスン';
}

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
  auto_materialized: number | null; // 1=月確定の自動実体化 / 0=手動作成・編集(振替等)
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
  start_date: string | null; // この日以降のみ展開 (NULL=制限なし)
  end_date: string | null;   // この日まで展開、翌日以降は生成しない (NULL=制限なし)
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
export async function buildLessonsForMonths(months: number, startYm?: string): Promise<ExportLesson[]> {
  const safeMonths = Math.max(1, Math.min(24, Math.floor(months) || 1));
  // startYm ('YYYY-MM') 指定時はその月を起点に。未指定なら今月起点(従来挙動)。
  let baseYear: number;
  let baseMonth: number;
  if (startYm && /^\d{4}-\d{2}$/.test(startYm)) {
    baseYear = parseInt(startYm.slice(0, 4), 10);
    baseMonth = parseInt(startYm.slice(5, 7), 10);
  } else {
    // M10: サーバTZ(Vercel=UTC)の getFullYear/getMonth だと、JSTの月初朝9時前に
    // 前月起点となり出力窓が1ヶ月ズレる。基準は常にJSTの今日から取る。
    const t = todayJst();
    baseYear = parseInt(t.slice(0, 4), 10);
    baseMonth = parseInt(t.slice(5, 7), 10); // 1-12
  }

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
       AND COALESCE(lm.calendar_scope, 'boom') = 'boom'
       AND (li.master_id IS NOT NULL OR COALESCE(li.notes, '') NOT LIKE '受託%')
     ORDER BY li.date, li.start_time`,
    [startStr, endStr]
  )) as InstanceRow[];

  const masters = (await getAll(
    `SELECT lm.id, lm.class_name, lm.default_day_of_week AS day_of_week, lm.default_start_time AS start_time,
            lm.default_end_time AS end_time, lm.duration_minutes, lm.frequency_type,
            lm.start_date, lm.end_date,
            s.name AS studio_name, i.name AS instructor_name
     FROM lesson_master lm
     LEFT JOIN studios s ON s.id = lm.default_studio_id
     LEFT JOIN instructors i ON i.id = lm.default_instructor_id
     WHERE lm.active = 1 AND COALESCE(lm.calendar_scope, 'boom') = 'boom'`
  )) as MasterRow[];

  const lessons: ExportLesson[] = [];

  // master の開始日/終了日マップ (instance 側も範囲外なら抑止するため。active 問わず取得)
  const dateRangeRows = (await getAll(
    `SELECT id, start_date, end_date FROM lesson_master WHERE start_date IS NOT NULL OR end_date IS NOT NULL`
  )) as { id: number; start_date: string | null; end_date: string | null }[];
  const masterDateRange = new Map(dateRangeRows.map(r => [r.id, r]));
  const outOfRange = (masterId: number | null, ds: string): boolean => {
    if (masterId == null) return false;
    const r = masterDateRange.get(masterId);
    if (!r) return false;
    return isMasterOutOfRange(r, ds);
  };

  const confirmedMonths = await getConfirmedMonthsSet();
  const expandedKeys = buildExpandedKeys(instances);

  // a) インスタンス (実開催/休講)
  for (const ins of instances) {
    if (ins.status === 'removed') continue;
    // M15: master期間外の抑止は「自動実体化されたinstance」のみに適用する。
    // 手動作成・編集(振替等。PATCHで auto_materialized=0 に落ちる)のinstanceは
    // スタッフの決定なので、masterの start_date/end_date 外でも出力する。
    // 旧実装は無条件に continue しており、期間外への振替がGoogleカレンダー/
    // HACOMONO出力から消えていた (buildLessonsForMonths は両方の共通経路)。
    if (ins.auto_materialized === 1 && outOfRange(ins.master_id, ins.date)) continue;
    const dow = new Date(ins.date + 'T00:00:00').getDay();
    lessons.push({
      date: ins.date,
      day_of_week: dow,
      start_time: ins.start_time,
      end_time: ins.end_time,
      class_name: instanceClassLabel(ins.master_class_name, ins.notes),
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

  // b) master展開 (expandedKeys にない日のみ、確定月はスキップ)
  // day_of_week を default_day_of_week にマッピング (expandMasterSlotsRange が参照)
  const mastersWithDow = masters.map(m => ({ ...m, default_day_of_week: m.day_of_week }));
  for (const { master: mas, dateStr: ds, dow } of expandMasterSlotsRange(startStr, endStr, mastersWithDow, expandedKeys, confirmedMonths)) {
    if (isMasterOutOfRange(mas, ds)) continue;
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
