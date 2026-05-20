import { getAll } from './db';
import { buildLessonsForMonths, type ExportLesson } from './scheduleExport';

// ============================================
// BW5マスタースケジュール -> HACOMONO スケジュールインポート形式CSV 変換
//
// HACOMONOのスケジュールCSVインポート (標準機能) に投入するCSVを生成する。
// キー項目 = 開始日時 (既存と一致すれば更新、無ければ新規)。
// 文字コードは呼び出し側で UTF-8 BOM を付与する。
//
// 仕様は調査済みのHACOMONOスケジュールインポート列に準拠。実際のCSVサンプルが
// 来たら DEFAULTS / HEADERS の列順・ラベルを微調整する想定 (定数化済み)。
// ============================================

/** HACOMONO スケジュールインポートCSV ヘッダ (項目名は仕様と完全一致させる) */
export const HACOMONO_HEADERS = [
  '店舗コード',
  '予約カテゴリコード',
  '開始日時',
  '終了日時',
  '公開日時',
  '予約受付終了時間',
  'キャンセル受付終了日時',
  'スペースコード',
  'スペースの選択が可能かどうか',
  'スタッフコード',
  'プログラムコード',
  'トライアル予約可能数',
  '無断キャンセル判定ポリシー',
  '非公開レッスンかどうか',
] as const;

/** デフォルト値 (実HACOMONO設定が来たら調整するため定数化) */
export const HACOMONO_DEFAULTS = {
  storeCode: 'S0001', // BOOM
  categoryCode: 'S0001_R0001', // 通常レッスン
  spaceSelectable: '0', // スペースの選択が可能かどうか (0=不可)
  trialCapacity: '1', // トライアル予約可能数 (体験者が通常枠に混ざる)
  noShowPolicy: '無断キャンセル扱いとしメール送信', // 無断キャンセル判定ポリシー
  publishLeadDays: 14, // 公開日時 = 開始の何日前か
  // 予約受付終了時間 / キャンセル受付終了日時 = 開始日時 (= 開始時刻まで受付)
} as const;

export type HacomonoMaps = {
  program: Map<string, { code: string; name: string }>;
  staff: Map<string, { code: string; name: string }>;
  space: Map<string, { code: string; name: string }>;
};

type MapRow = {
  entity_type: string;
  bw5_key: string;
  hacomono_code: string;
  hacomono_name: string | null;
};

/** hacomono_schedule_map を entity_type 別の Map に読み込む */
export async function loadHacomonoMaps(): Promise<HacomonoMaps> {
  const rows = (await getAll(
    'SELECT entity_type, bw5_key, hacomono_code, hacomono_name FROM hacomono_schedule_map'
  )) as MapRow[];
  const maps: HacomonoMaps = { program: new Map(), staff: new Map(), space: new Map() };
  for (const r of rows) {
    const entry = { code: r.hacomono_code, name: r.hacomono_name ?? '' };
    if (r.entity_type === 'program') maps.program.set(r.bw5_key, entry);
    else if (r.entity_type === 'staff') maps.staff.set(r.bw5_key, entry);
    else if (r.entity_type === 'space') maps.space.set(r.bw5_key, entry);
  }
  return maps;
}

export type HacomonoRow = {
  cells: string[]; // HACOMONO_HEADERS と同順
  start: string; // 開始日時 (キー項目)
  className: string;
  unresolved: string[]; // 未解決のエンティティ種別 ('program'|'staff'|'space')
};

export type HacomonoExportResult = {
  rows: HacomonoRow[];
  matchedCount: number; // 全コード解決済みの行数
  unresolvedCount: number; // 1つ以上未解決の行数
  unresolvedDetail: {
    programs: string[]; // 未解決のBW5 class_name (ユニーク)
    staff: string[];
    spaces: string[];
  };
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" + "HH:MM[:SS]" -> "YYYY-MM-DD HH:MM:SS" */
function toDateTime(date: string, time: string | null): string {
  if (!time) return `${date} 00:00:00`;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!m) return `${date} 00:00:00`;
  const hh = pad(parseInt(m[1], 10));
  const mm = m[2];
  const ss = m[3] ?? '00';
  return `${date} ${hh}:${mm}:${ss}`;
}

/** 開始日時の publishLeadDays 日前を公開日時とする */
function publishDateTime(date: string, time: string | null, leadDays: number): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time ?? '');
  const [y, mo, d] = date.split('-').map(n => parseInt(n, 10));
  const dt = new Date(y, (mo || 1) - 1, d || 1, m ? parseInt(m[1], 10) : 0, m ? parseInt(m[2], 10) : 0, 0);
  dt.setDate(dt.getDate() - leadDays);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
}

/**
 * 1レッスンをHACOMONO行に変換。
 * 休講(status='cancelled')は「非公開レッスンかどうか」=1。
 * マッピング未解決のコードは空欄にし、unresolved に種別を記録する。
 */
export function lessonToHacomonoRow(l: ExportLesson, maps: HacomonoMaps): HacomonoRow {
  const start = toDateTime(l.date, l.start_time);
  const end = toDateTime(l.date, l.end_time);
  const publish = publishDateTime(l.date, l.start_time, HACOMONO_DEFAULTS.publishLeadDays);

  const program = maps.program.get(l.class_name);
  const staff = l.instructor_name ? maps.staff.get(l.instructor_name) : undefined;
  const space = l.studio_name ? maps.space.get(l.studio_name) : undefined;

  const unresolved: string[] = [];
  if (!program) unresolved.push('program');
  if (l.instructor_name && !staff) unresolved.push('staff');
  if (l.studio_name && !space) unresolved.push('space');

  const isCancelled = l.status === 'cancelled' ? '1' : '0';

  const cells = [
    HACOMONO_DEFAULTS.storeCode,
    HACOMONO_DEFAULTS.categoryCode,
    start,
    end,
    publish,
    start, // 予約受付終了時間 = 開始日時
    start, // キャンセル受付終了日時 = 開始日時
    space?.code ?? '',
    HACOMONO_DEFAULTS.spaceSelectable,
    staff?.code ?? '',
    program?.code ?? '',
    HACOMONO_DEFAULTS.trialCapacity,
    HACOMONO_DEFAULTS.noShowPolicy,
    isCancelled,
  ];

  return { cells, start, className: l.class_name, unresolved };
}

/** 期間内レッスンをHACOMONO行に変換し、未解決サマリ付きで返す */
export async function buildHacomonoExport(months: number): Promise<HacomonoExportResult> {
  const lessons = await buildLessonsForMonths(months);
  const maps = await loadHacomonoMaps();

  const rows: HacomonoRow[] = [];
  const unresolvedPrograms = new Set<string>();
  const unresolvedStaff = new Set<string>();
  const unresolvedSpaces = new Set<string>();
  let matchedCount = 0;
  let unresolvedCount = 0;

  for (const l of lessons) {
    const row = lessonToHacomonoRow(l, maps);
    rows.push(row);
    if (row.unresolved.length === 0) {
      matchedCount++;
    } else {
      unresolvedCount++;
      if (row.unresolved.includes('program')) unresolvedPrograms.add(l.class_name);
      if (row.unresolved.includes('staff') && l.instructor_name) unresolvedStaff.add(l.instructor_name);
      if (row.unresolved.includes('space') && l.studio_name) unresolvedSpaces.add(l.studio_name);
    }
  }

  return {
    rows,
    matchedCount,
    unresolvedCount,
    unresolvedDetail: {
      programs: [...unresolvedPrograms].sort(),
      staff: [...unresolvedStaff].sort(),
      spaces: [...unresolvedSpaces].sort(),
    },
  };
}

/** RFC 4180 セルエスケープ */
function csvCell(v: string): string {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** HacomonoExportResult を CSV文字列 (CRLF, BOMなし) に変換 */
export function hacomonoResultToCsv(result: HacomonoExportResult): string {
  const lines: string[] = [];
  lines.push(HACOMONO_HEADERS.map(csvCell).join(','));
  for (const r of result.rows) {
    lines.push(r.cells.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
