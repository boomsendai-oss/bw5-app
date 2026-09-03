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

import { getAll, getOne } from './db';
import { todayJst } from './dateJst';
import { getAdCost, getTrafficChannels } from './ga4';
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

  const [thisWeek, prevWeek, membersNow, finance, prevFinance, prevToDateRow, trialsMonth, adCost, chThis, chPrev, seo, trialCvr, planMovement] =
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
      // GA4の実広告費(当月1日〜昨日)。GA4は当日分が固まらないので終端は昨日。
      // 未設定/権限エラーでもレポート全体を落とさない(available=false で「未計測」表示)。
      getAdCost(`${ym}-01`, shift(today, -1)).catch(() => null),
      // 流入チャネル(GA4)。週次窓そのまま。終端が未来日でもGA4は実在日だけ返す
      getTrafficChannels(start, end).catch(() => null),
      getTrafficChannels(prevStart, prevEnd).catch(() => null),
      gatherSeoSummary(),
      gatherTrialCvr(today),
      gatherPlanMovement(ym, pym, start, end, prevStart, prevEnd),
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
      ad_cost_ga4:
        adCost && adCost.available
          ? { amount: adCost.cost, currency: adCost.currency, clicks: adCost.clicks }
          : null,
    },
    traffic: {
      this_week: chThis && chThis.available ? { channels: chThis.channels, total: chThis.total_sessions } : null,
      prev_week: chPrev && chPrev.available ? { channels: chPrev.channels, total: chPrev.total_sessions } : null,
    },
    seo,
    trial_cvr: trialCvr,
    plan_movement: planMovement,
    state,
    insights_url: `${BASE_URL}/staff/insights`,
    data_gaps: dataGaps,
  };
}

/**
 * SEO週次サマリーをDBから組み立てる(GSC自動取込の成果物を読むだけ・API呼び出しなし)。
 * seo_rank_snapshots(source=gsc)の直近2回で順位差分、gsc_query_snapshotsで新規クエリ、
 * gsc_page_snapshotsでページ別上位を出す。テーブル未作成・データ無しなら null。
 */
export async function gatherSeoSummary(): Promise<WeeklyReportInput['seo']> {
  try {
    const dates = await getAll(
      `SELECT DISTINCT measured_on FROM seo_rank_snapshots WHERE source='gsc' ORDER BY measured_on DESC LIMIT 2`
    );
    if (dates.length === 0) return null;
    const cur = String(dates[0].measured_on);
    const prev = dates.length > 1 ? String(dates[1].measured_on) : null;

    const curRows = await getAll(
      `SELECT query, position, impressions, clicks, out_of_range FROM seo_rank_snapshots
        WHERE source='gsc' AND measured_on = ? ORDER BY (position IS NULL), position`,
      [cur]
    );
    const prevRows = prev
      ? await getAll(
          `SELECT query, position FROM seo_rank_snapshots WHERE source='gsc' AND measured_on = ?`,
          [prev]
        )
      : [];
    // GSCのクエリは表記ゆれ(スペース有無)で同じ語が複数行になるため、空白無視で1行に集約する。
    // 順位は最良値(検索者は同じ語を引いている)、表示/クリックは合算。
    const norm = (q: string) => q.replace(/[\s\u3000]/g, '');
    const prevBest = new Map<string, number | null>();
    for (const r of prevRows) {
      const k = norm(String(r.query));
      const pos = r.position === null ? null : Number(r.position);
      const cur0 = prevBest.get(k);
      if (cur0 === undefined || (pos !== null && (cur0 === null || pos < cur0))) prevBest.set(k, pos);
    }
    const byNorm = new Map<string, { query: string; position: number | null; impressions: number; clicks: number }>();
    for (const r of curRows) {
      const k = norm(String(r.query));
      const pos = r.position === null ? null : Number(r.position);
      const e = byNorm.get(k);
      if (!e) {
        byNorm.set(k, { query: String(r.query), position: pos, impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0) });
      } else {
        e.impressions += Number(r.impressions ?? 0);
        e.clicks += Number(r.clicks ?? 0);
        if (pos !== null && (e.position === null || pos < e.position)) { e.position = pos; e.query = String(r.query); }
      }
    }
    const keywords = [...byNorm.entries()]
      .map(([k, e]) => ({
        query: e.query,
        position: e.position,
        prev_position: prevBest.has(k) ? (prevBest.get(k) ?? null) : null,
        impressions: e.impressions,
        clicks: e.clicks,
      }))
      .sort((a, b) => (a.position === null ? 1 : 0) - (b.position === null ? 1 : 0) || (a.position ?? 999) - (b.position ?? 999));

    // 新規クエリ: 今回スナップショットにあって前回に無い語(表示2回以上・追跡済みの語は除く)
    let newQueries: { query: string; impressions: number; position: number }[] = [];
    if (prev) {
      const rows = await getAll(
        `SELECT c.query, c.impressions, c.position FROM gsc_query_snapshots c
          WHERE c.measured_on = ? AND c.impressions >= 2
            AND NOT EXISTS (SELECT 1 FROM gsc_query_snapshots p WHERE p.measured_on = ? AND p.query = c.query)
          ORDER BY c.impressions DESC LIMIT 5`,
        [cur, prev]
      );
      const trackedNorm = new Set(keywords.map((k) => k.query.replace(/[\s\u3000]/g, '')));
      newQueries = rows
        .map((r) => ({ query: String(r.query), impressions: Number(r.impressions ?? 0), position: Number(r.position ?? 0) }))
        .filter((r) => !trackedNorm.has(r.query.replace(/[\s\u3000]/g, '')));
    }

    const pageRows = await getAll(
      `SELECT page, clicks, impressions FROM gsc_page_snapshots
        WHERE measured_on = ? AND clicks > 0 ORDER BY clicks DESC, impressions DESC LIMIT 3`,
      [cur]
    );
    const topPages = pageRows.map((r) => ({
      page: String(r.page).replace(/^https?:\/\/[^/]+/, '') || '/',
      clicks: Number(r.clicks ?? 0),
      impressions: Number(r.impressions ?? 0),
    }));

    const totalRow = await getOne(
      `SELECT SUM(clicks) AS c, SUM(impressions) AS i FROM gsc_query_snapshots WHERE measured_on = ?`,
      [cur]
    );
    const totals = totalRow && totalRow.i !== null ? { clicks: Number(totalRow.c ?? 0), impressions: Number(totalRow.i ?? 0) } : null;

    return { keywords, new_queries: newQueries, top_pages: topPages, totals, measured_on: cur, prev_measured_on: prev };
  } catch {
    return null; // テーブル未作成・DB障害でもレポート全体は落とさない
  }
}

/**
 * 体験→入会CVR(直近3コホート月)。
 * settled = そのコホート月の月末から45日以上経過(enrolled_afterの熟成期間)。
 * 45日の根拠: 紐付けラグ実測で30日以内成立は約2割のみ(2026-09-01調査)。
 */
export async function gatherTrialCvr(todayIso: string): Promise<WeeklyReportInput['trial_cvr']> {
  try {
    const rows = await getAll(
      `SELECT substr(reserved_at,1,7) AS m,
              COUNT(*) AS trials,
              SUM(CASE WHEN status LIKE '%キャンセル%' THEN 1 ELSE 0 END) AS cancelled,
              SUM(enrolled_after) AS enrolled
         FROM trial_records
        WHERE reserved_at >= date(?, '-4 months')
        GROUP BY m ORDER BY m DESC LIMIT 3`,
      [todayIso]
    );
    if (rows.length === 0) return null;
    const nowMs = new Date(`${todayIso}T00:00:00+09:00`).getTime();
    const months = rows
      .map((r) => {
        const m = String(r.m);
        const [y, mo] = m.split('-').map(Number);
        const monthEndMs = Date.UTC(y, mo, 1) - 9 * 3600_000; // JST翌月1日0時
        return {
          month: m,
          trials: Number(r.trials ?? 0),
          cancelled: Number(r.cancelled ?? 0),
          enrolled: Number(r.enrolled ?? 0),
          settled: nowMs - monthEndMs >= 45 * 24 * 3600_000,
        };
      })
      .reverse();
    return { months };
  } catch {
    return null;
  }
}

/** 商品名から月謝プラン名を正規化する(純関数)。プラン以外は null */
export function normalizePlanName(productName: string): string | null {
  const n = productName ?? '';
  if (n.includes('休会')) return null;
  if (n.includes('チケット会員')) return null;
  if (n.includes('管理者') || n.includes('インストラクター')) return null;
  if (n.includes('受け放題')) return '受け放題';
  if (n.includes('カレッジ')) return 'カレッジ';
  if (n.includes('月謝4回(60分)')) return '60分4回';
  if (n.includes('月謝4回(90分)')) return '90分4回';
  if (n.includes('月謝8回(60分)')) return '60分8回';
  if (n.includes('月謝8回(90分)')) return '90分8回';
  return null;
}

export async function gatherPlanMovement(
  ym: string,
  pym: string,
  weekStart: string,
  weekEnd: string,
  prevStart: string,
  prevEnd: string
): Promise<WeeklyReportInput['plan_movement']> {
  try {
    const rows = await getAll(
      `SELECT substr(billing_date,1,7) AS m, product_name, amount
         FROM hacomono_billing_records
        WHERE product_category = 'plan' AND billing_date >= ? AND billing_date < date(?, '+1 month')`,
      [`${pym}-01`, `${ym}-01`]
    );
    const agg: Record<string, Record<string, { count: number; amount: number }>> = {};
    let onLeave = 0;
    for (const r of rows) {
      const m = String(r.m);
      const name = String(r.product_name ?? '');
      if (m === ym && name.includes('休会')) onLeave += 1;
      const plan = normalizePlanName(name);
      if (!plan) continue;
      agg[m] ??= {};
      agg[m][plan] ??= { count: 0, amount: 0 };
      agg[m][plan].count += 1;
      agg[m][plan].amount += Number(r.amount ?? 0);
    }
    const sumOf = (m: string) => Object.values(agg[m] ?? {}).reduce((a, p) => a + p.amount, 0);
    const order = ['受け放題', '60分4回', '90分4回', '90分8回', '60分8回', 'カレッジ'];
    const plans = order
      .filter((k) => agg[ym]?.[k])
      .map((k) => ({ name: k, count: agg[ym][k].count, amount: agg[ym][k].amount }));

    const fee = async (a: string, b: string) =>
      Number(
        (
          await getOne(
            `SELECT COUNT(*) AS n FROM hacomono_billing_records
              WHERE product_name LIKE '%システム変更手数料%' AND billing_date BETWEEN ? AND ?`,
            [a, `${b}T23:59:59`]
          )
        )?.n ?? 0
      );
    const [thisW, prevW, monthN] = await Promise.all([
      fee(weekStart, weekEnd),
      fee(prevStart, prevEnd),
      fee(`${ym}-01`, `${ym}-31`),
    ]);
    return {
      month: ym,
      prev_month: pym,
      plan_revenue: sumOf(ym),
      prev_plan_revenue: sumOf(pym),
      plans,
      change_fees_this_week: thisW,
      change_fees_prev_week: prevW,
      change_fees_month: monthN,
      on_leave: onLeave,
    };
  } catch {
    return null;
  }
}
