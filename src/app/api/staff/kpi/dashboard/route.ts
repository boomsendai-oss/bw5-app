import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getActiveMemberCount, getActiveMemberCountByType, getUtilizationRate, NON_CUSTOMER_TYPES_SQL } from '@/lib/kpiMetrics';

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

  // ===== 一括並列取得 =====
  // 以前は20本超のクエリを逐次awaitしており、1本ごとのDB往復(Turso)が積み上がって
  // 毎回5秒超かかっていた。各クエリは互いに独立なので Promise.all で一括並列化する。
  // 計算(派生値)は取得後にまとめて行う。SQL・定義は従来と同一。
  // P3: 給与・スタジオ料 runs の確定分/未確定(draft)分を1本のクエリで分けて取る。
  // payroll_runs / studio_billing_runs は同じ status 遷移(draft→confirmed→paid)・同じ列構成。
  const RUN_TOTAL_SQL = (table: string) =>
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('confirmed','paid') THEN total_amount END), 0) AS confirmed_total,
       COALESCE(SUM(CASE WHEN status = 'draft' THEN total_amount END), 0) AS draft_total,
       COALESCE(SUM(CASE WHEN status IN ('confirmed','paid') THEN 1 ELSE 0 END), 0) AS confirmed_cnt,
       COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_cnt
     FROM ${table} WHERE year_month = ?`;

  const UTIL_EXPR =
    `CASE WHEN capacity IS NOT NULL AND capacity > 0
          THEN CAST(total_reservations AS REAL) / capacity
          ELSE utilization_rate END`;

  const [
    startActiveRow,
    endActive,
    regularActive,
    ticketActive,
    collegeActive,
    ticketEngagedRow,
    newSignupsRow,
    churnedRow,
    trialCountRow,
    trialEnrolledRow,
    lineFriendsRow,
    lineBlockedRow,
    lineTotalRow,
    billingRows,
    merchTotalRow,
    videoSettings,
    videoCountRow,
    utilClassRows,
    overrideRows,
    lowThrRow,
    graceRow,
    avgUtilization,
    payrollTotalRow,
    studioTotalRow,
    expensesByCategory,
    billingCountRow,
    payrollCountRow,
    studioCountRow,
    expenseCountRow,
    targets,
  ] = await Promise.all([
    // B: 顧客動態 — 在籍系は全て課金対象顧客のみ(staff/休会/visitor除外 = T-164)
    safeOne(
      `SELECT COUNT(*) AS n FROM boom_members
       WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
         AND (withdrew_at IS NULL OR withdrew_at > ?)
         AND ${NON_CUSTOMER_TYPES_SQL}`,
      [monthStart, monthStart]
    ),
    // 月末在籍数 — 正準ロジック(src/lib/kpiMetrics.ts)に集約
    getActiveMemberCount(ym),
    getActiveMemberCountByType(ym, 'regular'),
    getActiveMemberCountByType(ym, 'ticket'),
    getActiveMemberCountByType(ym, 'college'),
    // チケット実働 (T-175): 月末時点で直近90日以内にチェックインがあれば実働
    safeOne(
      `SELECT COUNT(*) AS n FROM boom_members m
       WHERE m.member_type='ticket' AND m.status='active'
         AND (m.withdrew_at IS NULL OR m.withdrew_at > ?)
         AND EXISTS (SELECT 1 FROM hacomono_reservations r
                     WHERE r.boom_member_id = m.id AND r.status='チェックイン'
                       AND r.lesson_date BETWEEN date(?, '-90 days') AND ?)`,
      [monthEndISO, monthEnd, monthEnd]
    ),
    safeOne(
      `SELECT COUNT(*) AS n FROM boom_members WHERE enrolled_at BETWEEN ? AND ? AND ${NON_CUSTOMER_TYPES_SQL}`,
      [monthStart, monthEndISO]
    ),
    safeOne(
      `SELECT COUNT(*) AS n FROM boom_members WHERE withdrew_at BETWEEN ? AND ? AND ${NON_CUSTOMER_TYPES_SQL}`,
      [monthStart, monthEndISO]
    ),
    safeOne(
      `SELECT COUNT(*) AS n FROM trial_records WHERE reserved_at BETWEEN ? AND ?`,
      [monthStart, monthEndISO]
    ),
    // CVR: 当月体験者のうち、体験日から14日以内に入会した人
    safeOne(
      `SELECT COUNT(DISTINCT tr.id) AS n
       FROM trial_records tr
       LEFT JOIN boom_members bm ON bm.id = tr.member_id
       WHERE tr.reserved_at BETWEEN ? AND ?
         AND bm.enrolled_at IS NOT NULL
         AND date(bm.enrolled_at) <= date(tr.reserved_at, '+14 days')
         AND date(bm.enrolled_at) >= date(tr.reserved_at)`,
      [monthStart, monthEndISO]
    ),
    safeOne(`SELECT COUNT(*) AS n FROM lstep_friends WHERE blocked = 0`),
    safeOne(`SELECT COUNT(*) AS n FROM lstep_friends WHERE blocked = 1`),
    safeOne(`SELECT COUNT(*) AS n FROM lstep_friends`),
    // A: 売上系
    safeAll(
      `SELECT product_category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
       FROM hacomono_billing_records
       WHERE billing_date BETWEEN ? AND ?
       GROUP BY product_category`,
      [monthStart, monthEnd]
    ),
    safeOne(
      // P4: 単価は注文時点に固定した unit_price を優先。未設定の過去行のみ現在価格へフォールバック
      // (バックフィルは価格改定履歴のTARO確認後)。
      `SELECT COALESCE(SUM(mo.quantity * COALESCE(mo.unit_price, m.price)), 0) AS total
       FROM merch_orders mo
       LEFT JOIN merchandise m ON m.id = mo.merch_id
       WHERE mo.created_at BETWEEN ? AND ?`,
      [monthStart, monthEndISO]
    ),
    safeOne(`SELECT value FROM settings WHERE key = 'video_price'`),
    safeOne(
      `SELECT COUNT(*) AS n FROM video_preorders WHERE created_at BETWEEN ? AND ? AND (status IS NULL OR status != 'duplicate')`,
      [monthStart, monthEndISO]
    ),
    // C: 稼働率 — 予約ベース(総予約数/定員)。定員なし行のみ保存値へフォールバック
    safeAll(
      `SELECT program_name, staff_name, AVG(${UTIL_EXPR}) AS avg_rate, COUNT(*) AS cnt
       FROM lesson_utilization WHERE lesson_date BETWEEN ? AND ?
       GROUP BY program_name, staff_name
       HAVING cnt >= 1`,
      [monthStart, monthEnd]
    ),
    safeAll(`SELECT program_name, category, launched_at FROM class_kpi_overrides`),
    safeOne(`SELECT value FROM settings WHERE key = 'kpi_util_low_threshold'`),
    safeOne(`SELECT value FROM settings WHERE key = 'kpi_util_new_grace_months'`),
    getUtilizationRate(ym),
    // D: 収益性
    // P3: 未確定(draft)のrunは「試しに計算しただけ」の仮値なので営業利益に混ぜない。
    // ただし draft しか無い月を0円扱いにすると経費が丸ごと消えて大幅黒字に見え、
    // 混入より危険なため「確定分があれば確定分／無ければdraft合計を暫定として返す」
    // 2段フォールバックにする(確定/暫定の別は provisional フラグでフロントへ渡す)。
    safeOne(RUN_TOTAL_SQL('payroll_runs'), [ym]),
    safeOne(RUN_TOTAL_SQL('studio_billing_runs'), [ym]),
    // 給与・スタジオ料は別管理のため expenses 側の同カテゴリは除外(T-166 二重計上防止)
    safeAll(
      `SELECT category, COALESCE(SUM(amount), 0) AS t FROM expenses
       WHERE expense_date BETWEEN ? AND ?
         AND category NOT IN ('給与', '人件費', 'スタジオ料', 'スタジオ使用料', 'スタジオ代')
       GROUP BY category`,
      [monthStart, monthEnd]
    ),
    // 締め確定ガード(T-158): 4財源の当月データ有無
    safeOne(`SELECT COUNT(*) AS c FROM hacomono_billing_records WHERE billing_date BETWEEN ? AND ?`, [monthStart, monthEnd]),
    safeOne(`SELECT COUNT(*) AS c FROM payroll_runs WHERE year_month = ?`, [ym]),
    safeOne(`SELECT COUNT(*) AS c FROM studio_billing_runs WHERE year_month = ?`, [ym]),
    safeOne(`SELECT COUNT(*) AS c FROM expenses WHERE expense_date BETWEEN ? AND ?`, [monthStart, monthEnd]),
    safeAll(`SELECT metric_key, target_value FROM kpi_targets WHERE year_month = ?`, [ym]),
  ]);

  // ===== B: 顧客動態 (派生値) =====
  const startActive = n(startActiveRow?.n);
  const ticketEngaged = n(ticketEngagedRow?.n);
  const ticketDormant = Math.max(0, ticketActive - ticketEngaged);
  const newSignups = n(newSignupsRow?.n);
  const churned = n(churnedRow?.n);
  const churnRate = startActive > 0 ? (churned / startActive) * 100 : 0;
  const netGrowth = newSignups - churned;
  const trialCount = n(trialCountRow?.n);
  const trialEnrolled = n(trialEnrolledRow?.n);
  const trialCvr = trialCount > 0 ? (trialEnrolled / trialCount) * 100 : 0;
  const lineFriendsNow = n(lineFriendsRow?.n);
  const lineBlocked = n(lineBlockedRow?.n);
  const lineTotal = n(lineTotalRow?.n);
  const lineBlockRate = lineTotal > 0 ? (lineBlocked / lineTotal) * 100 : 0;

  // ===== A: 売上系 (派生値) =====
  const revenueBreakdown = {
    plan: 0, ticket: 0, enrollment_fee: 0, other: 0,
  } as Record<string, number>;
  for (const r of billingRows) {
    const cat = (r.product_category as string | null) ?? 'other';
    revenueBreakdown[cat] = n(r.total);
  }
  const coreRevenue = revenueBreakdown.plan + revenueBreakdown.ticket + revenueBreakdown.enrollment_fee;
  const arpu = endActive > 0 ? revenueBreakdown.plan / endActive : 0;
  const merchTotal = n(merchTotalRow?.total);
  const videoPrice = n(videoSettings?.value);
  const videoCount = n(videoCountRow?.n);
  const overrideMap = new Map<string, { category: string | null; launched_at: string | null }>();
  for (const o of overrideRows) {
    overrideMap.set(o.program_name as string, {
      category: (o.category as string | null) ?? null,
      launched_at: (o.launched_at as string | null) ?? null,
    });
  }

  // しきい値 (settings に行があれば尊重、無ければデフォルト)
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

  // ヘッドライン平均 = normal クラスのみ・予約数 (cnt) 重み付け。
  // 正準ロジックは src/lib/kpiMetrics.ts の getUtilizationRate に集約。
  // ここの分類(上の normalClasses/newClasses/...)はクラス別リスト表示用に
  // 残すが、ヘッドラインの数値は正準関数を呼んで二重定義を排除する。
  const normalWeightSum = normalClasses.reduce((a, c) => a + c.cnt, 0);
  const utilLessonCount = normalWeightSum;
  // data_available は分類前の元データの有無で判定 (全件除外でも未取込扱いにしない)
  const utilHasData = utilClassRows.length > 0;

  // TOP/BOTTOM は通常クラスから算出 (後方互換)
  const topClasses = [...normalClasses].sort((a, b) => b.avg_rate - a.avg_rate).slice(0, 10);
  const bottomClasses = [...normalClasses].sort((a, b) => a.avg_rate - b.avg_rate).slice(0, 10);

  // ===== D: 収益性 (派生値) =====
  // P3: 確定(confirmed/paid)があればそれを採用。無ければdraft合計を「暫定」として使う。
  function runTotal(row: Row | null): { total: number; provisional: boolean } {
    const confirmedCnt = n(row?.confirmed_cnt);
    if (confirmedCnt > 0) return { total: n(row?.confirmed_total), provisional: false };
    const draftCnt = n(row?.draft_cnt);
    return { total: n(row?.draft_total), provisional: draftCnt > 0 };
  }
  const payroll = runTotal(payrollTotalRow);
  const studio = runTotal(studioTotalRow);
  const payrollTotal = payroll.total;
  const studioTotal = studio.total;
  const provisionalSources = [
    ...(payroll.provisional ? ['給与'] : []),
    ...(studio.provisional ? ['スタジオ料'] : []),
  ];
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

  // 締め確定ガード(T-158): 営業利益=売上−給与−スタジオ料−経費 だが、各財源の
  // 当月データが揃わないと利益が虚偽になる。4財源それぞれの当月行有無を返し、
  // フロントは全部揃った月だけ黒字赤字を確定表示する。
  const billingCount = n(billingCountRow?.c);
  const payrollCount = n(payrollCountRow?.c);
  const studioCount = n(studioCountRow?.c);
  const expenseCount = n(expenseCountRow?.c);
  const sourceAvailability = {
    revenue: billingCount > 0,
    payroll: payrollCount > 0,
    studio: studioCount > 0,
    expenses: expenseCount > 0,
  };
  const missingSources = Object.entries(sourceAvailability)
    .filter(([, ok]) => !ok)
    .map(([k]) => ({ revenue: '売上(課金)', payroll: '給与', studio: 'スタジオ料', expenses: '経費' }[k] ?? k));
  const profitConfirmed = missingSources.length === 0;

  // ===== 目標値 =====
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
      // member_type 別内訳 (T-164): 月額/チケット/カレッジを分離表示
      regular_active: regularActive,
      ticket_active: ticketActive,
      ticket_engaged: ticketEngaged,
      ticket_dormant: ticketDormant,
      college_active: collegeActive,
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
      // 締め確定ガード(T-158): 4財源が全て揃った月だけ profit_confirmed=true。
      // フロントは false の月は黒字赤字を確定表示せず「データ不足」を出す。
      source_availability: sourceAvailability,
      missing_sources: missingSources,
      profit_confirmed: profitConfirmed,
      // P3: 確定(confirmed/paid)のrunが無くdraftだけの財源。金額は暫定値。
      payroll_provisional: payroll.provisional,
      studio_provisional: studio.provisional,
      provisional_sources: provisionalSources,
    },
    targets: targetMap,
    generated_at: new Date().toISOString(),
    _prev_unused: prevStart, // 前月比対応用にダミー(将来)
  });
}

function toYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
