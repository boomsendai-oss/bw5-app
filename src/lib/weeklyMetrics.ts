// WS AB: 週次経営レポートのDB集計。
//
// 月次(売上・収益性)は `kpiMetrics.getMonthlyFinance` = /staff/insights と同一の正準関数を呼ぶ。
// ここが独自SQLを持つのは「週ウィンドウの入口数字(入会/退会/体験/LINE追加)」だけ。
//
// 数値の性質(TARO判断に使われるため明記):
//   - 入会/退会は boom_members の enrolled_at / withdrew_at(HACOMONO日次同期の値)
//   - 体験は trial_records.reserved_at(Lstep体験予約CSV)
//   - LINE友だち追加は lstep_friends.created_at = 「日次同期で初めて現れた日」であり
//     LINE上の友だち追加日そのものではない(近似)。文面側でその旨を明記している。

import { getOne } from './db';
import { todayJst } from './dateJst';
import { getActiveMemberCount, getMonthlyFinance, NON_CUSTOMER_TYPES_SQL } from './kpiMetrics';
import { lastFullWeek, type WeeklyReportInput, type WindowCounts } from './weeklyReport';

const BASE_URL = 'https://bw5-app.vercel.app';

function num(v: unknown): number {
  return Number(v ?? 0);
}

async function safeCount(sql: string, args: (string | number)[]): Promise<number | null> {
  try {
    const row = await getOne(sql, args);
    return num(row?.n);
  } catch {
    return null;
  }
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
function ymOf(iso: string): string {
  return iso.slice(0, 7);
}

/** 'YYYY-MM' の前月 */
function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** N日前の 'YYYY-MM-DD' */
function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 指定ウィンドウ(両端含む)の入口カウント。取得失敗した指標は 0 ではなく null を返す。 */
async function windowCounts(start: string, end: string): Promise<WindowCounts & { unavailable: string[] }> {
  const endISO = `${end}T23:59:59`;
  const [signups, churned, trials, lineNew] = await Promise.all([
    safeCount(
      `SELECT COUNT(*) AS n FROM boom_members
        WHERE enrolled_at BETWEEN ? AND ? AND ${NON_CUSTOMER_TYPES_SQL}`,
      [start, endISO]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM boom_members
        WHERE withdrew_at BETWEEN ? AND ? AND ${NON_CUSTOMER_TYPES_SQL}`,
      [start, endISO]
    ),
    safeCount(`SELECT COUNT(*) AS n FROM trial_records WHERE reserved_at BETWEEN ? AND ?`, [start, endISO]),
    safeCount(`SELECT COUNT(*) AS n FROM lstep_friends WHERE created_at BETWEEN ? AND ?`, [start, endISO]),
  ]);
  const unavailable: string[] = [];
  if (signups === null) unavailable.push('入会');
  if (churned === null) unavailable.push('退会');
  if (trials === null) unavailable.push('体験予約');
  if (lineNew === null) unavailable.push('LINE友だち追加');
  return {
    new_signups: signups ?? 0,
    churned: churned ?? 0,
    trials: trials ?? 0,
    line_new: lineNew ?? 0,
    unavailable,
  };
}

export type StateExtract = WeeklyReportInput['state'];

/**
 * 週次レポートの入力データを組み立てる。
 * @param state GitHub Actions が STATE.md から抽出して渡す締切/ボトルネック
 * @param now   テスト用の基準時刻
 */
export async function buildWeeklyReportInput(
  state: StateExtract,
  now: Date = new Date()
): Promise<WeeklyReportInput & { data_gaps: string[] }> {
  const today = todayJst(now);
  const { start, end } = lastFullWeek(today);
  const prevStart = shift(start, -7);
  const prevEnd = shift(start, -1);

  const ym = ymOf(today);
  const pym = prevYm(ym);
  const dayOfMonth = Number(today.slice(8, 10));
  // 前月の「同じ日まで」= 前月1日〜前月の同日(前月にその日が無ければ末日でクランプ)
  const [py, pmo] = pym.split('-').map(Number);
  const prevLastDay = new Date(py, pmo, 0).getDate();
  const prevSameDay = `${pym}-${String(Math.min(dayOfMonth, prevLastDay)).padStart(2, '0')}`;

  const [thisWeek, prevWeek, membersNow, finance, prevFinance, prevToDateRow, trialsMonth] =
    await Promise.all([
      windowCounts(start, end),
      windowCounts(prevStart, prevEnd),
      getActiveMemberCount(ym).catch(() => null),
      getMonthlyFinance(ym),
      getMonthlyFinance(pym),
      getOne(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM hacomono_billing_records
          WHERE billing_date BETWEEN ? AND ?
            AND product_category IN ('plan','ticket','enrollment_fee')`,
        [`${pym}-01`, prevSameDay]
      ).catch(() => null),
      safeCount(`SELECT COUNT(*) AS n FROM trial_records WHERE reserved_at BETWEEN ? AND ?`, [
        `${ym}-01`,
        `${today}T23:59:59`,
      ]),
    ]);

  const adSpend = finance.profitability.expense_breakdown.広告費 ?? 0;

  const dataGaps = [...new Set([...thisWeek.unavailable, ...prevWeek.unavailable])];
  if (membersNow === null) dataGaps.push('在籍数');

  return {
    week_start: start,
    week_end: end,
    members_now: membersNow ?? 0,
    members_unavailable: membersNow === null,
    this_week: thisWeek,
    prev_week: prevWeek,
    year_month: ym,
    prev_year_month: pym,
    revenue: {
      core: finance.revenue.core,
      breakdown: finance.revenue.breakdown,
      prev_to_date: num(prevToDateRow?.n),
      prev_full: prevFinance.revenue.core,
      data_available: finance.revenue.data_available,
    },
    profit: {
      operating_profit: finance.profitability.operating_profit,
      profit_margin: finance.profitability.profit_margin,
      revenue: finance.profitability.revenue,
      payroll: finance.profitability.payroll,
      studio: finance.profitability.studio,
      expenses_total: finance.profitability.total_expenses,
      expense_breakdown: finance.profitability.expense_breakdown,
      profit_confirmed: finance.profitability.profit_confirmed,
      missing_sources: finance.profitability.missing_sources,
      provisional_sources: finance.profitability.provisional_sources,
    },
    entry: {
      trials_month: trialsMonth ?? 0,
      // 経費として1円も計上が無い月は「0円使った」ではなく「未計測」として扱う
      ad_spend_month: adSpend > 0 ? adSpend : null,
    },
    state,
    insights_url: `${BASE_URL}/staff/insights`,
    data_gaps: dataGaps,
  };
}
