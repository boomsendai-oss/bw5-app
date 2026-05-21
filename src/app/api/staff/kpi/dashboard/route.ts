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
  // enrolled_at/withdrew_at は 'YYYY-MM-DD HH:MM:SS' 形式で保存されるため、
  // 月末日の時刻付き行 (例 '2026-05-31 21:00:00') を取りこぼさないよう
  // 境界には日付のみの monthEnd ではなく monthEndISO (…T23:59:59) を使う。
  // 月末日の入会者が endActive から漏れて newSignups と矛盾する不具合を防ぐ。
  const endActive = n((await safeOne(
    `SELECT COUNT(*) AS n FROM boom_members
     WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
       AND (withdrew_at IS NULL OR withdrew_at > ?)`,
    [monthEndISO, monthEndISO]
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
  // ブロック済み友だち数 と ブロック率 (配信健全性KPI)
  const lineBlocked = n((await safeOne(`SELECT COUNT(*) AS n FROM lstep_friends WHERE blocked = 1`))?.n);
  const lineTotal = n((await safeOne(`SELECT COUNT(*) AS n FROM lstep_friends`))?.n);
  const lineBlockRate = lineTotal > 0 ? (lineBlocked / lineTotal) * 100 : 0;

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
  // 予約ベース稼働率 = 総予約数 / 定員。
  // HACOMONO RS002 の「稼働率」列はチェックイン(実出席)ベースのため、
  // まだ出席を取っていない/月途中のレッスンは予約があっても 0% と記録される
  // (例: 多賀城HOUSE/おっちゃん系が 0% に見えていた原因)。
  // 経営判断では「どれだけ枠が予約で埋まっているか」が重要なので予約ベースを採用。
  // 定員が無い行のみ、保存済み稼働率にフォールバック。
  const UTIL_EXPR =
    `CASE WHEN capacity IS NOT NULL AND capacity > 0
          THEN CAST(total_reservations AS REAL) / capacity
          ELSE utilization_rate END`;

  // クラス別 (program_name, staff_name) 集計 — 当月。
  // ここで取得した各クラスを後段でカテゴリ分類し、ヘッドライン平均は
  // 「通常クラス(normal)」のみで予約数 (cnt) 重み付けして算出する。
  const utilClassRows = await safeAll(
    `SELECT program_name, staff_name, AVG(${UTIL_EXPR}) AS avg_rate, COUNT(*) AS cnt
     FROM lesson_utilization WHERE lesson_date BETWEEN ? AND ?
     GROUP BY program_name, staff_name
     HAVING cnt >= 1`,
    [monthStart, monthEnd]
  );

  // 分類上書き設定 (program_name 単位)
  const overrideRows = await safeAll(`SELECT program_name, category, launched_at FROM class_kpi_overrides`);
  const overrideMap = new Map<string, { category: string | null; launched_at: string | null }>();
  for (const o of overrideRows) {
    overrideMap.set(o.program_name as string, {
      category: (o.category as string | null) ?? null,
      launched_at: (o.launched_at as string | null) ?? null,
    });
  }

  // しきい値 (settings に行があれば尊重、無ければデフォルト)
  const lowThrRow = await safeOne(`SELECT value FROM settings WHERE key = 'kpi_util_low_threshold'`);
  const graceRow = await safeOne(`SELECT value FROM settings WHERE key = 'kpi_util_new_grace_months'`);
  const lowThreshold = lowThrRow && lowThrRow.value != null ? Number(lowThrRow.value) : 0.20;
  const graceMonths = graceRow && graceRow.value != null ? Number(graceRow.value) : 6;

  // 立ち上げ期判定の基準日 (今日) と grace 期間の起点
  const now = new Date();
  const graceCutoff = new Date(now.getFullYear(), now.getMonth() - graceMonths, now.getDate());

  type ClassAgg = { program_name: string; staff_name: string; avg_rate: number; cnt: number; launched_at?: string };
  const normalClasses: ClassAgg[] = [];
  const newClasses: ClassAgg[] = [];
  const watchClasses: ClassAgg[] = [];
  const excludedClasses: ClassAgg[] = [];

  for (const r of utilClassRows) {
    const programName = (r.program_name as string | null) ?? '';
    const staffName = (r.staff_name as string | null) ?? '';
    const avgRate = Number(r.avg_rate ?? 0);
    const cnt = n(r.cnt);
    const ov = overrideMap.get(programName);
    const base: ClassAgg = { program_name: programName, staff_name: staffName, avg_rate: avgRate, cnt };

    // 優先順位: excluded > new > watch > normal
    // 1) excluded: program_name === 'イベント' または override.category === 'exclude'
    if (programName === 'イベント' || ov?.category === 'exclude') {
      excludedClasses.push(base);
      continue;
    }
    // 2) new(立ち上げ期): override.category === 'new'、または launched_at が grace_months 以内
    const launchedAt = ov?.launched_at ?? null;
    const isNewByDate = !!launchedAt && new Date(launchedAt) >= graceCutoff;
    if (ov?.category === 'new' || (ov?.category == null && isNewByDate)) {
      newClasses.push({ ...base, launched_at: launchedAt ?? undefined });
      continue;
    }
    // override.category === 'normal' は強制的に通常 (自動watch判定を上書き)
    if (ov?.category === 'normal') {
      normalClasses.push(base);
      continue;
    }
    // 3) watch(要対策): override.category === 'watch'、または avg_rate < low_threshold
    if (ov?.category === 'watch' || avgRate < lowThreshold) {
      watchClasses.push(base);
      continue;
    }
    // 4) normal(通常)
    normalClasses.push(base);
  }

  // ヘッドライン平均 = normal クラスのみ・予約数 (cnt) 重み付け
  const normalWeightSum = normalClasses.reduce((a, c) => a + c.cnt, 0);
  const normalWeightedRate = normalClasses.reduce((a, c) => a + c.avg_rate * c.cnt, 0);
  const avgUtilization = normalWeightSum > 0 ? normalWeightedRate / normalWeightSum : 0;
  const utilLessonCount = normalWeightSum;
  // data_available は分類前の元データの有無で判定 (全件除外でも未取込扱いにしない)
  const utilHasData = utilClassRows.length > 0;

  // TOP/BOTTOM は通常クラスから算出 (後方互換)
  const topClasses = [...normalClasses].sort((a, b) => b.avg_rate - a.avg_rate).slice(0, 10);
  const bottomClasses = [...normalClasses].sort((a, b) => a.avg_rate - b.avg_rate).slice(0, 10);

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
      blocked: lineBlocked,
      total: lineTotal,
      block_rate: lineBlockRate,
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
    // average/lesson_count は normal(通常)クラスのみ・予約数重み付け。
    // new(立ち上げ期)/watch(要対策)/excluded(除外) は別枠で返す。
    utilization: {
      average: avgUtilization,
      lesson_count: utilLessonCount,
      data_available: utilHasData,
      rate_basis: '予約数 ÷ 定員', // 稼働率の計算根拠
      low_threshold: lowThreshold,
      grace_months: graceMonths,
      top_classes: topClasses,
      bottom_classes: bottomClasses,
      new_classes: newClasses,
      watch_classes: watchClasses,
      excluded_classes: excludedClasses,
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
