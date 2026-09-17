/**
 * Lstep体験予約の「消失」検出。
 *
 * Lstepで予約が削除・日時変更されると、予約一覧CSVからその行が消えるだけで
 * 「キャンセル」行としては出てこない。取込がUPSERTだけだと、アプリ側に古い予約が
 * 「予約済」のまま永久に残る(2026-09-17 TARO指摘: 10/3→10/10へ変更した予約の10/3が残留)。
 *
 * 取込のたびに「CSVの対象期間内で、DBにはあるのにCSVに無い予約」を拾い、
 * 部分CSVの誤判定を避けるための安全弁(カバレッジ・上限)を通ったものだけ
 * status='キャンセル' / status_source='lstep_absent' にする。
 * 安全弁に引っかかった場合は何も変えず、候補として返して人が確認する
 * (会員同期の退会検出 sync/route.ts と同じ考え方)。
 */

export type AbsentCandidate = {
  id: number;
  lstep_id: string | null;
  reserved_at: string;
  status: string | null;
};

export type AbsentPlan<T extends AbsentCandidate> = {
  /** 判定対象になったDB行数(窓内・lstep_idあり・未キャンセル) */
  roster: number;
  /** 対象行のうち今回CSVに含まれていた割合(0〜1)。対象0件なら1 */
  coverage: number;
  /** CSVに無かった行 */
  disappeared: T[];
  /** 自動でキャンセル扱いにしてよいか */
  canAuto: boolean;
};

export const ABSENT_COVERAGE_MIN = 0.9;
export const ABSENT_AUTO_MAX = 5;

export function trialKey(lstepId: string | null | undefined, reservedAt: string): string {
  return `${lstepId ?? ''}|${reservedAt}`;
}

export function planAbsentCancellations<T extends AbsentCandidate>(opts: {
  dbRows: T[];
  csvKeys: Set<string>;
  coverageMin?: number;
  autoMax?: number;
}): AbsentPlan<T> {
  const coverageMin = opts.coverageMin ?? ABSENT_COVERAGE_MIN;
  const autoMax = opts.autoMax ?? ABSENT_AUTO_MAX;

  const roster = opts.dbRows.filter(
    (r) => !!r.lstep_id && (r.status ?? '').trim() !== 'キャンセル'
  );
  const present = roster.filter((r) => opts.csvKeys.has(trialKey(r.lstep_id, r.reserved_at)));
  const disappeared = roster.filter((r) => !opts.csvKeys.has(trialKey(r.lstep_id, r.reserved_at)));
  const coverage = roster.length > 0 ? present.length / roster.length : 1;
  const canAuto = coverage >= coverageMin && disappeared.length <= autoMax;
  return { roster: roster.length, coverage, disappeared, canAuto };
}

/**
 * CSVに含まれる予約日時から、消失判定の窓(日付)を推定する。
 * daily_sync が range_from/range_to を渡してこない場合のフォールバック。
 * 窓が狭いぶんには「拾えない」だけで誤判定はしないので安全側。
 */
export function inferWindowFromRows(reservedAts: string[]): { from: string; to: string } | null {
  const dates = reservedAts.map((s) => s.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0) return null;
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}
