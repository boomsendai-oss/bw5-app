import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getActiveMemberCount, getActiveMemberCountByType, getMonthlyFinance, getUtilizationRate, NON_CUSTOMER_TYPES_SQL } from '@/lib/kpiMetrics';

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
  // 売上・収益性(旧: この route 内のSQL+派生計算)は `getMonthlyFinance` へ移設した。
  // 週次経営レポートのメールが同じ数字を出す必要があり、コピペすると将来ズレるため。
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
    utilClassRows,
    overrideRows,
    lowThrRow,
    graceRow,
    avgUtilization,
    finance,
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
    // A: 売上系 + D: 収益性 — 正準集計(src/lib/kpiMetrics.ts)。
    // 週次経営レポートのメールも同じ関数を呼ぶため、画面とメールの数字が構造的に一致する。
    getMonthlyFinance(ym),
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
  // 金額そのものは getMonthlyFinance が正準。ここは画面固有の派生値(ARPU)だけ持つ。
  const arpu = endActive > 0 ? finance.revenue.breakdown.plan / endActive : 0;
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
  // 締め確定ガード(T-158)・draft暫定フォールバック(P3)・経費の二重計上防止(T-166)は
  // すべて getMonthlyFinance 側にある(週次レポートと共有する正準ロジック)。

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
    revenue: { ...finance.revenue, arpu },
    // 補助売上
    aux_revenue: finance.aux_revenue,
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
    // 締め確定ガード(T-158)で profit_confirmed=false の月は、フロントが
    // 黒字赤字を確定表示せず「データ不足」を出す。
    profitability: finance.profitability,
    targets: targetMap,
    generated_at: new Date().toISOString(),
    _prev_unused: prevStart, // 前月比対応用にダミー(将来)
  });
}

function toYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
