import { getAll } from './db';
import { buildLessonsForMonths, type ExportLesson } from './scheduleExport';

// ============================================
// BW5マスタースケジュール -> HACOMONO スケジュール インポート/エクスポート形式CSV 変換
//
// 実物のHACOMONOエクスポートCSV (boom_studio_lesson_*.csv) と
// 列順・列数(29列)・セル形式 (`CODE: 名前`) ・真偽値(true/false)・各enumを完全一致させる。
// これが import / export 共通フォーマットの正解。
//
// HACOMONOでは「プログラム」がスタッフ/スペース/トライアル数/各フラグを規定するため、
// 変換は BW5 class_name -> program(PGコード) を起点に既定値を引き当てる。
// スタッフのみ BW5側で講師が確定していれば優先する。
//
// 文字コードは呼び出し側で UTF-8 BOM を付与する。
// ============================================

/** HACOMONO スケジュール エクスポートCSV ヘッダ (実物と完全一致・29列) */
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
  'お知らせ',
  'お知らせテーマ',
  'お知らせ表示タイプ',
  'お知らせテキスト配置',
  '非公開メモ',
  '無料体験かどうか',
  '非公開レッスンかどうか',
  'キャンセル待ち登録を許可するかどうか',
  'キャンセル受付終了後のスペース移動を許可するかどうか',
  'オンライン利用のお知らせ',
  'オンライン利用のお知らせ配信タイミング (分)',
  'オンライン配信URL',
  'オンライン配信ID',
  'オンライン配信パスワード',
  'トライアル予約受付終了日時',
  'トライアルキャンセル受付終了日時',
] as const;

/** デフォルト値 (実物CSVに準拠) */
export const HACOMONO_DEFAULTS = {
  storeCode: 'S0001',
  storeName: 'BOOM',
  categoryCode: 'S0001_R0001',
  categoryName: '通常レッスン',
  // 無断キャンセル判定ポリシー (実物の正確な文字列・読点込み)
  noShowPolicy: '無断キャンセル扱いとし、メールを送信する',
  // 公開日時を固定値で出すプログラムの公開日時 (実物: 2026-04-01 00:00:00)
  publishFixedAt: '2026-04-01 00:00:00',
  trialCapacity: 5, // program既定が無い場合のトライアル予約可能数
} as const;

/** program行 (BW5 class_name -> PGコード) の既定属性 */
export type ProgramEntry = {
  code: string;
  name: string;
  staffCode: string | null;
  spaceCode: string | null;
  trialCapacity: number;
  spaceSelectable: boolean;
  spaceMovable: boolean;
  publishFixed: boolean;
};

export type HacomonoMaps = {
  program: Map<string, ProgramEntry>;
  staff: Map<string, { code: string; name: string }>;
  space: Map<string, { code: string; name: string }>;
};

type MapRow = {
  entity_type: string;
  bw5_key: string;
  hacomono_code: string;
  hacomono_name: string | null;
  default_staff_code: string | null;
  default_space_code: string | null;
  trial_capacity: number | null;
  space_selectable: number | null;
  space_movable: number | null;
  publish_fixed: number | null;
};

/** hacomono_schedule_map を entity_type 別の Map に読み込む */
export async function loadHacomonoMaps(): Promise<HacomonoMaps> {
  const rows = (await getAll(
    `SELECT entity_type, bw5_key, hacomono_code, hacomono_name,
            default_staff_code, default_space_code, trial_capacity,
            space_selectable, space_movable, publish_fixed
     FROM hacomono_schedule_map`
  )) as MapRow[];
  const maps: HacomonoMaps = { program: new Map(), staff: new Map(), space: new Map() };
  for (const r of rows) {
    if (r.entity_type === 'program') {
      maps.program.set(r.bw5_key, {
        code: r.hacomono_code,
        name: r.hacomono_name ?? '',
        staffCode: r.default_staff_code,
        spaceCode: r.default_space_code,
        trialCapacity: r.trial_capacity ?? HACOMONO_DEFAULTS.trialCapacity,
        spaceSelectable: r.space_selectable === 1,
        spaceMovable: r.space_movable === 1,
        publishFixed: r.publish_fixed === 1,
      });
    } else if (r.entity_type === 'staff') {
      maps.staff.set(r.bw5_key, { code: r.hacomono_code, name: r.hacomono_name ?? '' });
    } else if (r.entity_type === 'space') {
      maps.space.set(r.bw5_key, { code: r.hacomono_code, name: r.hacomono_name ?? '' });
    }
  }
  return maps;
}

export type HacomonoRow = {
  cells: string[]; // HACOMONO_HEADERS と同順 (29列)
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

/** `CODE: 名前` 形式 (名前が空なら CODE のみ) */
function codeWithName(code: string, name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n ? `${code}: ${n}` : code;
}

/**
 * 1レッスンをHACOMONO行 (29列) に変換。
 * - 店舗/カテゴリ/スペース/スタッフ/プログラムは `CODE: 名前` 形式。
 * - スタッフは BW5 instructor が解決できればそれを優先、無ければ program 既定。
 * - スペース・トライアル数・各フラグ・公開日時は program 既定に従う。
 * - 休講(status='cancelled')は「非公開レッスンかどうか」=true。
 * マッピング未解決のコードは空欄にし、unresolved に種別を記録する。
 */
export function lessonToHacomonoRow(l: ExportLesson, maps: HacomonoMaps): HacomonoRow {
  const start = toDateTime(l.date, l.start_time);
  const end = toDateTime(l.date, l.end_time);

  const program = maps.program.get(l.class_name);

  // スタッフ: BW5講師が解決できれば優先、無ければ program 既定スタッフ
  const bw5Staff = l.instructor_name ? maps.staff.get(l.instructor_name) : undefined;
  let staffCell = '';
  let staffResolved = false;
  if (bw5Staff) {
    staffCell = codeWithName(bw5Staff.code, bw5Staff.name);
    staffResolved = true;
  } else if (program?.staffCode) {
    const sd = maps.staff.get(program.staffCode);
    // program既定のスタッフコードは hacomono_code 側なので名前を逆引き (無ければコードのみ)
    const name = sd ? sd.name : staffNameByCode(maps, program.staffCode);
    staffCell = codeWithName(program.staffCode, name);
    staffResolved = true;
  }

  // スペース: program 既定スペース
  let spaceCell = '';
  let spaceResolved = false;
  if (program?.spaceCode) {
    const name = spaceNameByCode(maps, program.spaceCode);
    spaceCell = codeWithName(program.spaceCode, name);
    spaceResolved = true;
  }

  const unresolved: string[] = [];
  if (!program) unresolved.push('program');
  if (!staffResolved) unresolved.push('staff');
  if (!spaceResolved) unresolved.push('space');

  const isCancelled = l.status === 'cancelled';
  const selectable = program?.spaceSelectable ?? false;
  const movable = program?.spaceMovable ?? false;
  const publishFixed = program?.publishFixed ?? false;
  const trial = program?.trialCapacity ?? HACOMONO_DEFAULTS.trialCapacity;

  const cells = [
    codeWithName(HACOMONO_DEFAULTS.storeCode, HACOMONO_DEFAULTS.storeName), // 店舗コード
    codeWithName(HACOMONO_DEFAULTS.categoryCode, HACOMONO_DEFAULTS.categoryName), // 予約カテゴリコード
    start, // 開始日時
    end, // 終了日時
    publishFixed ? HACOMONO_DEFAULTS.publishFixedAt : '', // 公開日時
    '', // 予約受付終了時間 (実物は基本空)
    '', // キャンセル受付終了日時 (実物は空)
    spaceCell, // スペースコード
    selectable ? 'true' : 'false', // スペースの選択が可能かどうか
    staffCell, // スタッフコード
    program ? codeWithName(program.code, program.name) : '', // プログラムコード
    String(trial), // トライアル予約可能数
    HACOMONO_DEFAULTS.noShowPolicy, // 無断キャンセル判定ポリシー
    l.notes ?? '', // お知らせ (BW5 notes を流用)
    '', // お知らせテーマ
    '', // お知らせ表示タイプ
    '', // お知らせテキスト配置
    '', // 非公開メモ
    'false', // 無料体験かどうか
    isCancelled ? 'true' : 'false', // 非公開レッスンかどうか (休講=true)
    'true', // キャンセル待ち登録を許可するかどうか
    movable ? 'true' : 'false', // キャンセル受付終了後のスペース移動を許可するかどうか
    '', // オンライン利用のお知らせ
    '', // オンライン利用のお知らせ配信タイミング (分)
    '', // オンライン配信URL
    '', // オンライン配信ID
    '', // オンライン配信パスワード
    '', // トライアル予約受付終了日時
    '', // トライアルキャンセル受付終了日時
  ];

  return { cells, start, className: l.class_name, unresolved };
}

/** staff行から hacomono_code -> 名前 を逆引き */
function staffNameByCode(maps: HacomonoMaps, code: string): string {
  for (const v of maps.staff.values()) if (v.code === code) return v.name;
  return '';
}

/** space行から hacomono_code -> 名前 を逆引き */
function spaceNameByCode(maps: HacomonoMaps, code: string): string {
  for (const v of maps.space.values()) if (v.code === code) return v.name;
  return '';
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
      if (row.unresolved.includes('staff')) unresolvedStaff.add(l.instructor_name ?? `(${l.class_name})`);
      if (row.unresolved.includes('space')) unresolvedSpaces.add(l.studio_name ?? `(${l.class_name})`);
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

/** RFC 4180 セルエスケープ。実物CSVは全セルをダブルクオートで囲うのでそれに合わせる。 */
function csvCell(v: string): string {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
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
