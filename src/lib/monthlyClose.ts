// 月次締めの再計算。画面のボタンと自動実行(cron)の両方から同じコードを呼ぶ。
// route に処理を書くと片方だけ直って乖離するため、ここに集約する。

import { getAll } from './db';
import { findRoomConflicts, type RoomConflict } from './roomConflicts';
import { calculatePayrollForMonth, persistPayrollRun, zeroStaleDraftPayrollRuns } from './payroll';
import {
  calculateStudioBillingForMonth, persistStudioBillingRun, zeroStaleDraftStudioBillingRuns,
} from './studioBilling';

export type PayrollWarning = { instructor_id: number; instructor_name: string; reason: string };

export type PayrollCalcResult = {
  year_month: string;
  payment_date: string;
  calculated: number;
  runs: { instructor_id: number; run_id: number; total_amount: number }[];
  warnings: PayrollWarning[];
  zeroed_stale_drafts: number;
};

/** 給与draftを再計算する。確定・配布・振込は行わない(人間のゲート)。 */
export async function recalcPayroll(ym: string): Promise<PayrollCalcResult> {
  const { payment_date, results } = await calculatePayrollForMonth(ym);
  const runs: PayrollCalcResult['runs'] = [];
  const warnings: PayrollWarning[] = [];
  for (const r of results) {
    // 単価未登録でサイレント¥0になっている講師を警告として返す(T-156)
    if (r.has_rate_missing) {
      warnings.push({
        instructor_id: r.instructor_id, instructor_name: r.instructor_name,
        reason: 'レッスンはあるが単価が未登録の行があります(¥0計上の恐れ)。instructor_rates を確認してください',
      });
    }
    // M2: 実時間バケット欠落で master分数バケットに代用計上した
    if (r.has_bucket_fallback) {
      warnings.push({
        instructor_id: r.instructor_id, instructor_name: r.instructor_name,
        reason: '実時間の単価が未登録のため、master設定分数の単価で代用計上しました。延長分の単価バケットを登録してください',
      });
    }
    // 純粋に0(単価未登録もなく実績もない)講師はskip。rate_missing があれば残して可視化する。
    if (
      r.total_lesson_amount === 0 && r.total_transit_amount === 0 &&
      r.salary_type !== 'monthly_fixed' && !r.has_rate_missing
    ) continue;
    const runId = await persistPayrollRun(ym, r, payment_date);
    runs.push({ instructor_id: r.instructor_id, run_id: runId, total_amount: r.total_lesson_amount + r.total_transit_amount });
  }
  const zeroed = await zeroStaleDraftPayrollRuns(ym, runs.map((i) => i.instructor_id));
  return { year_month: ym, payment_date, calculated: runs.length, runs, warnings, zeroed_stale_drafts: zeroed };
}

export type StudioCalcResult = {
  year_month: string;
  calculated: number;
  runs: { studio_id: number; run_id: number; total_amount: number }[];
  zeroed_stale_drafts: number;
};

/** スタジオ料を再生成する。実費型(公共施設)は¥0の枠だけ作られ、金額は領収書から別途入れる。 */
export async function recalcStudioBilling(ym: string): Promise<StudioCalcResult> {
  const { results, payment_dates } = await calculateStudioBillingForMonth(ym);
  const runs: StudioCalcResult['runs'] = [];
  for (const r of results) {
    if (r.lines.length === 0) continue;
    const runId = await persistStudioBillingRun(ym, r, payment_dates[r.studio_id]);
    runs.push({ studio_id: r.studio_id, run_id: runId, total_amount: r.total_lesson_amount });
  }
  const zeroed = await zeroStaleDraftStudioBillingRuns(ym, runs.map((i) => i.studio_id));
  return { year_month: ym, calculated: runs.length, runs, zeroed_stale_drafts: zeroed };
}

/** 同じ部屋・同じ時間に2レッスンが入っている物理的に不可能な計上を探す */
export async function detectRoomConflicts(ym: string): Promise<RoomConflict[]> {
  const rows = (await getAll(
    `SELECT li.id, li.date, li.start_time, li.end_time, li.studio_id, s.name AS studio_name,
            COALESCE(lm.class_name,
                     CASE WHEN li.notes LIKE '単発: %' THEN SUBSTR(li.notes, 5)
                          WHEN li.notes LIKE '給与対象外: %' THEN SUBSTR(li.notes, 8)
                          ELSE li.notes END, '?') AS label
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     LEFT JOIN studios s ON s.id = li.studio_id
     WHERE li.date LIKE ? AND li.status NOT IN ('cancelled', 'removed')`,
    [`${ym}%`]
  )) as unknown as Parameters<typeof findRoomConflicts>[0];
  return findRoomConflicts(rows);
}

export type CloseStatus = {
  year_month: string;
  payrollRuns: number;
  payrollDraft: number;
  payrollTotal: number;
  studioRuns: number;
  studioTotal: number;
  /** 実費型で金額が未入力の会場(領収書待ち) */
  awaitingReceipt: string[];
};

/** 締めの進み具合。催促メールの判断材料。 */
export async function getCloseStatus(ym: string): Promise<CloseStatus> {
  const pay = (await getAll(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amt
     FROM payroll_runs WHERE year_month = ? GROUP BY status`,
    [ym]
  )) as unknown as { status: string; n: number; amt: number }[];
  const studio = (await getAll(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_amount),0) AS amt
     FROM studio_billing_runs WHERE year_month = ?`,
    [ym]
  )) as unknown as { n: number; amt: number }[];
  // 実費型で¥0のまま = 領収書の金額がまだ入っていない。
  // ただし payment_type='platform' の会場(スペースマーケット/インスタベース等)は
  // 銀行明細から expenses に自動計上されるため **常に¥0が正しい**。
  // これを催促に含めると毎回鳴って本当の抜けを見落とすので除外する。
  const awaiting = (await getAll(
    `SELECT s.name FROM studio_billing_runs r JOIN studios s ON s.id = r.studio_id
     WHERE r.year_month = ? AND s.pricing_model = 'actual'
       AND COALESCE(s.payment_type, '') <> 'platform' AND r.total_amount = 0`,
    [ym]
  )) as unknown as { name: string }[];

  return {
    year_month: ym,
    payrollRuns: pay.reduce((a, b) => a + Number(b.n), 0),
    payrollDraft: pay.filter((p) => p.status === 'draft').reduce((a, b) => a + Number(b.n), 0),
    payrollTotal: pay.reduce((a, b) => a + Number(b.amt), 0),
    studioRuns: Number(studio[0]?.n ?? 0),
    studioTotal: Number(studio[0]?.amt ?? 0),
    awaitingReceipt: awaiting.map((a) => a.name),
  };
}
