// kpi_snapshots(月ごとの経営数字の記録)を作るときの判断を純関数にまとめたもの。
// route から切り出してあるのは、月またぎ・経費の扱いをテストで固定するため(2026-11-13)。

/** 月の何日までは前月の行も取り直すか。遅れて入る課金・経費・給与確定を前月に反映する */
export const FINALIZE_PREV_MONTH_UNTIL_DAY = 10;

function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 今日(JST 'YYYY-MM-DD')に記録すべき月(古い順)。
 * 月初(1〜10日)は前月→当月の2か月、それ以外は当月だけ。
 */
export function snapshotTargetMonths(todayJstIso: string): string[] {
  const ym = todayJstIso.slice(0, 7);
  const day = Number(todayJstIso.slice(8, 10));
  return day <= FINALIZE_PREV_MONTH_UNTIL_DAY ? [prevYm(ym), ym] : [ym];
}

/**
 * 記録する経費。正準集計(給与・スタジオ料・経費・決済手数料の合計)を使う。
 * 正準が0円(どれも未取込)で、手入力の値が入っている月だけ手入力を残す。
 */
export function pickSnapshotExpense(canonical: number, existingManual: number | null | undefined): number {
  if (canonical > 0) return canonical;
  const manual = Number(existingManual ?? 0);
  return manual > 0 ? manual : 0;
}
