import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Row = Record<string, unknown>;

async function safeOne(sql: string, args: (string | number)[] = []): Promise<Row | null> {
  try { return (await getOne(sql, args)) as Row | null; } catch { return null; }
}
async function safeAll(sql: string, args: (string | number)[] = []): Promise<Row[]> {
  try { return (await getAll(sql, args)) as Row[]; } catch { return []; }
}
function n(v: unknown): number { return Number(v ?? 0); }

// GET /api/staff/kpi/dashboard?year_month=YYYY-MM
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month') ?? toYM(new Date());
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const monthEndISO = `${monthEnd}T23:59:59`;
  const prevYm = toYM(new Date(y, m - 2, 1));
  const prevStart = `${prevYm}-01`;

  // ===== B: 顧客動態 =====
  // 月初在籍数 = 月初時点で active かつ enrolled_at <= 月初(または NULL) かつ (withdrew_at IS NULL or > 月初)
  const startActive = n((await safeOne(
    `SELECT COUNT(*) AS n FROM boom_members
     WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
       AND (withdrew_at IS NULL OR withdrew_at > ?)`,
    [monthStart, monthStart]
  ))?.n);
  // 月末在籍数
  const endActive = n((await safeOne(
    `SELECT COUNT(*) AS n FROM boom_members
     WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
       AND (withdrew_at IS NULL OR withdrew_at > ?)`,
    [monthEnd, monthEnd]
  ))?.n);
  // 当月新規入会
  const newSignups = n((await safeOne(
    `SELECT COUNT(*) AS n FROM boom_members WHERE enrolled_at BETWEEN ? AND ?`,
    [monthStart, monthEndISO]
  ))?.n);
  // 当月退会
  const churned = n((await safeOne(
    `SELECT COUNT(*) AS n FROM boom_members WHERE withdrew_at BETWEEN ? AND ?`,
    [monthStart, monthEndISO]
  ))?.n);
  const churnRate = startActive > 0 ? (churned / startActive) * 100 : 0;
  const netGrowth = newSignups - churned;

  // 体験申込数 (当月)
  const trialCount = n((await safeOne(
    `SELECT COUNT(*) AS n FROM trial_records WHERE reserved_at BETWEEN ? AND ?`,
    [monthStart, monthEndISO]
  ))?.n);
  // CVR: 当月体験者のうち、体験日から14日以内に入会した人
  const trialEnrolled = n((await safeOne(
    `SELECT COUNT(DISTINCT tr.id) AS n
     FROM trial_records tr
     LEFT JOIN boom_members bm ON bm.id = tr.member_id
     WHERE tr.reserved_at BETWEEN ? AND ?
       AND bm.enrolled_at IS NOT NULL
       AND date(bm.enrolled_at) <= date(tr.reserved_at, '+14 days')
       AND date(bm.enrolled_at) >= date(tr.reserved_at)`,
    [monthStart, monthEndISO]
  ))?.n);
  const trialCvr = trialCount > 0 ? (trialEnrolled / trialCount) * 100 : 0;

  // LINE友だち数 (現在値) と前月差
  const lineFriendsNow = n((await safeOne(`SELECT COUNT(*) AS n FROM lstep_friends WHERE blocked = 0`))?.n);

  // ===== A: 売上系 =====
  // hacomono_billing_records が無ければ未取込
  const billingRows = await safeAll(
    `SELECT product_category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
     FROM hacomono_billing_records
     WHERE billing_date BETWEEN ? AND ?
     GROUP BY product_category`,
    [monthStart, monthEnd]
  );
  const revenueBreakdown = {
    plan: 0, ticket: 0, enrollment_fee: 0, other: 0,
  } as Record<string, number>;
  for (const r of billingRows) {
    const cat = (r.product_category as string | null) ?? 'other';
    revenueBreakdown[cat] = n(r.total);
  }
  const coreRevenue = revenueBreakdown.plan + revenueBreakdown.ticket + revenueBreakdown.enrollment_fee;
  const arpu = endActive > 0 ? revenueBreakdown.plan / endActive : 0;

  // 補助売上 (物販/映像)
  const merchTotal = n((await safeOne(
    `SELECT COALESCE(SUM(quantity * (SELECT price FROM merchandise WHERE id = mo.merch_id)), 0) AS total
     FROM merch_orders mo WHERE created_at BETWEEN ? AND ?`,
    [monthStart, monthEndISO]
  ))?.total);
  const videoSettings = await safeOne(`SELECT value FROM settings WHERE key = 'video_price'`);
  const videoPrice = n(videoSettings?.value);
  const videoCount = n((await safeOne(
    `SELECT COUNT(*) AS n FROM video_preorders WHERE created_at BETWEEN ? AND ? AND (status IS NULL OR status != 'duplicate')`,
    [monthStart, monthEndISO]
  ))?.n);

  // ===== C: オペレーション (稼働率) =====
  const utilRows = await safeAll(
    `SELECT AVG(utilization_rate) AS avg_rate, COUNT(*) AS lessons
     FROM lesson_utilization WHERE lesson_date BETWEEN ? AND ?`,
    [monthStart, monthEnd]
  );
  const avgUtilization = utilRows[0] ? Number(utilRows[0].avg_rate ?? 0) : 0;
  const utilLessonCount = utilRows[0] ? n(utilRows[0].lessons) : 0;

  // クラス別稼働率 TOP10 (高い順) / ボトム10 (低い順)
  const topClasses = await safeAll(
    `SELECT program_name, staff_name, AVG(utilization_rate) AS avg_rate, COUNT(*) AS cnt
     FROM lesson_utilization WHERE lesson_date BETWEEN ? AND ?
     GROUP BY program_name, staff_name
     HAVING cnt >= 1
     ORDER BY avg_rate DESC LIMIT 10`,
    [monthStart, monthEnd]
  );
  const bottomClasses = await safeAll(
    `SELECT program_name, staff_name, AVG(utilization_rate) AS avg_rate, COUNT(*) AS cnt
     FROM lesson_utilization WHERE lesson_date BETWEEN ? AND ?
     GROUP BY program_name, staff_name
     HAVING cnt >= 1
     ORDER BY avg_rate ASC LIMIT 10`,
    [monthStart, monthEnd]
  );

  // ===== D: 収益性 =====
  const payrollTotal = n((await safeOne(
    `SELECT COALESCE(SUM(total_amount), 0) AS t FROM payroll_runs WHERE year_month = ?`, [ym]
  ))?.t);
  const studioTotal = n((await safeOne(
    `SELECT COALESCE(SUM(total_amount), 0) AS t FROM studio_billing_runs WHERE year_month = ?`, [ym]
  ))?.t);
  const expensesByCategory = await safeAll(
    `SELECT category, COALESCE(SUM(amount), 0) AS t FROM expenses
     WHERE expense_date BETWEEN ? AND ? GROUP BY category`,
    [monthStart, monthEnd]
  );
  const expBreakdown = {
    広告費: 0, システム費: 0, 通信費: 0, 備品: 0, その他: 0,
  } as Record<string, number>;
  for (const e of expensesByCategory) {
    const cat = e.category as string;
    if (cat in expBreakdown) expBreakdown[cat] = n(e.t);
    else expBreakdown.その他 += n(e.t);
  }
  const totalExpenses = payrollTotal + studioTotal + Object.values(expBreakdown).reduce((a, b) => a + b, 0);
  const operatingProfit = coreRevenue - totalExpenses;

  // ===== 目標値 =====
  const targets = await safeAll(`SELECT metric_key, target_value FROM kpi_targets WHERE year_month = ?`, [ym]);
  const targetMap: Record<string, number> = {};
  for (const t of targets) targetMap[t.metric_key as string] = Number(t.target_value);

  return NextResponse.json({
    year_month: ym,
    prev_year_month: prevYm,
    period: { start: monthStart, end: monthEnd },
    // B 顧客動態
    members: {
      start_active: startActive,
      end_active: endActive,
      new_signups: newSignups,
      churned: churned,
      net_growth: netGrowth,
      churn_rate: churnRate,
    },
    trial: {
      count: trialCount,
      enrolled_within_14d: trialEnrolled,
      cvr: trialCvr,
    },
    line: {
      friends_now: lineFriendsNow,
    },
    // A 売上系
    revenue: {
      core: coreRevenue,
      breakdown: revenueBreakdown,
      arpu: arpu,
      data_available: billingRows.length > 0,
    },
    // 補助売上
    aux_revenue: {
      merch_orders: merchTotal,
      video_preorders_estimate: videoCount * videoPrice,
      video_preorder_count: videoCount,
    },
    // C オペレーション
    utilization: {
      average: avgUtilization,
      lesson_count: utilLessonCount,
      top_classes: topClasses,
      bottom_classes: bottomClasses,
      data_available: utilLessonCount > 0,
    },
    // D 収益性
    profitability: {
      revenue: coreRevenue,
      payroll: payrollTotal,
      studio: studioTotal,
      expense_breakdown: expBreakdown,
      total_expenses: totalExpenses,
      operating_profit: operatingProfit,
      profit_margin: coreRevenue > 0 ? (operatingProfit / coreRevenue) * 100 : 0,
    },
    targets: targetMap,
    generated_at: new Date().toISOString(),
    _prev_unused: prevStart, // 前月比対応用にダミー(将来)
  });
}

function toYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
