import { getOne, getAll } from './db';

type Row = Record<string, unknown>;

async function safeOne(sql: string, args: (string | number)[] = []): Promise<Row | null> {
  try { return (await getOne(sql, args)) as Row | null; } catch { return null; }
}
async function safeAll(sql: string, args: (string | number)[] = []): Promise<Row[]> {
  try { return (await getAll(sql, args)) as Row[]; } catch { return []; }
}
function n(v: unknown): number { return Number(v ?? 0); }

/**
 * 経営KPIの「正準(canonical)」集計ロジック。
 *
 * 在籍数・売上は画面ごとに別ロジックで計算され数値が食い違っていた。
 * ここに正準定義を集約し、各APIはこの関数を呼ぶ。
 * SQLは `src/app/api/staff/kpi/dashboard/route.ts`(経営インサイト)の
 * 正準SQLと完全に一致させてある(実データで一致確認済み)。
 */

/** 'YYYY-MM' を [year, month(1-12)] に分解 */
function splitYm(ym: string): [number, number] {
  const [y, m] = ym.split('-').map(Number);
  return [y, m];
}

/**
 * 在籍数から除外する member_type (T-164)。
 * - staff: スタッフアカウント(顧客ではない)
 * - 休会: 休会中(課金対象外)
 * - visitor: 課金CSV取込が自動生成した氏名未確認の仮レコード
 * member_type が NULL の行は顧客とみなして含める(安全側)。
 * 課金対象顧客 = regular + ticket + college (本番172名 = HACOMONO契約中と一致)。
 */
export const NON_CUSTOMER_TYPES_SQL = `(member_type IS NULL OR member_type NOT IN ('staff', '休会', 'visitor'))`;

/**
 * 指定月末時点の在籍数(日付ウィンドウ方式)。ym='YYYY-MM'。
 *
 * dashboard route の「月末在籍数(endActive)」と同一定義:
 *   (enrolled_at IS NULL OR enrolled_at <= 月末) AND (withdrew_at IS NULL OR withdrew_at > 月末)
 *
 * enrolled_at/withdrew_at は 'YYYY-MM-DD HH:MM:SS' 形式で保存されるため、
 * 月末日の時刻付き行(例 '2026-05-31 21:00:00')を取りこぼさないよう
 * 境界は日付のみの monthEnd ではなく monthEndISO('…T23:59:59') を使う。
 */
export async function getActiveMemberCount(ym: string): Promise<number> {
  const [y, m] = splitYm(ym);
  const lastDay = new Date(y, m, 0).getDate();
  const monthEndISO = `${ym}-${String(lastDay).padStart(2, '0')}T23:59:59`;
  const row = await getOne(
    `SELECT COUNT(*) AS n FROM boom_members
      WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
        AND (withdrew_at IS NULL OR withdrew_at > ?)
        AND ${NON_CUSTOMER_TYPES_SQL}`,
    [monthEndISO, monthEndISO]
  );
  return Number(row?.n ?? 0);
}

/**
 * member_type 別の月末在籍数 (T-164)。
 * 'regular'(月額) / 'ticket'(チケット) / 'college'(カレッジ) などを個別に数える。
 * 成長戦略を「月額会員を増やすのか、チケット会員を増やすのか」で分けて
 * 議論できるようにダッシュボードに並記する用途。
 */
export async function getActiveMemberCountByType(ym: string, memberType: string): Promise<number> {
  const [y, m] = splitYm(ym);
  const lastDay = new Date(y, m, 0).getDate();
  const monthEndISO = `${ym}-${String(lastDay).padStart(2, '0')}T23:59:59`;
  const row = await getOne(
    `SELECT COUNT(*) AS n FROM boom_members
      WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
        AND (withdrew_at IS NULL OR withdrew_at > ?)
        AND member_type = ?`,
    [monthEndISO, monthEndISO, memberType]
  );
  return Number(row?.n ?? 0);
}

/**
 * 指定月の売上(hacomono_billing_records 実集計)。ym='YYYY-MM'。
 *
 * dashboard route の売上集計と同一定義:
 *   SUM(amount) WHERE billing_date BETWEEN 月初 AND 月末
 *
 * billing_date は日付のみ 'YYYY-MM-DD' 形式で保存されるため、
 * 境界も日付のみ(monthStart / monthEnd)で BETWEEN する。
 * (dashboard は product_category 別に内訳を出すが、合計は同じ)
 */
export async function getMonthlyRevenue(ym: string): Promise<number> {
  const [y, m] = splitYm(ym);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const row = await getOne(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM hacomono_billing_records
      WHERE billing_date BETWEEN ? AND ?`,
    [monthStart, monthEnd]
  );
  return Number(row?.total ?? 0);
}

/**
 * 指定月の稼働率(0〜1の実数)。ym='YYYY-MM'。
 *
 * dashboard route(経営インサイト)の「ヘッドライン稼働率(avgUtilization)」と
 * 同一定義。SQL・分類ロジック・重み付けを **そのまま** 集約してある:
 *   - 予約ベース: capacity があれば total_reservations / capacity、無ければ
 *     保存済み utilization_rate にフォールバック。
 *   - クラス別(program_name, staff_name)に AVG で集計後、各クラスを
 *     excluded / new(立ち上げ期) / watch(要対策) / normal に分類。
 *   - ヘッドライン = normal(通常)クラスのみ・予約数(cnt)重み付け平均。
 *
 * trends route もこの関数を呼ぶことで、インサイトのヘッドライン稼働率と
 * トレンドグラフの最新月が完全一致する。
 */
export async function getUtilizationRate(ym: string): Promise<number> {
  const [y, m] = splitYm(ym);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;

  const UTIL_EXPR =
    `CASE WHEN capacity IS NOT NULL AND capacity > 0
          THEN CAST(total_reservations AS REAL) / capacity
          ELSE utilization_rate END`;

  // クラス別 (program_name, staff_name) 集計 — 当月。
  const utilClassRows = (await getAll(
    `SELECT program_name, staff_name, AVG(${UTIL_EXPR}) AS avg_rate, COUNT(*) AS cnt
     FROM lesson_utilization WHERE lesson_date BETWEEN ? AND ?
     GROUP BY program_name, staff_name
     HAVING cnt >= 1`,
    [monthStart, monthEnd]
  )) as Record<string, unknown>[];

  if (utilClassRows.length === 0) return 0;

  // 分類上書き設定 (program_name 単位)
  const overrideRows = (await getAll(
    `SELECT program_name, category, launched_at FROM class_kpi_overrides`
  )) as Record<string, unknown>[];
  const overrideMap = new Map<string, { category: string | null; launched_at: string | null }>();
  for (const o of overrideRows) {
    overrideMap.set(o.program_name as string, {
      category: (o.category as string | null) ?? null,
      launched_at: (o.launched_at as string | null) ?? null,
    });
  }

  // しきい値 (settings に行があれば尊重、無ければデフォルト)
  const lowThrRow = await getOne(`SELECT value FROM settings WHERE key = 'kpi_util_low_threshold'`);
  const graceRow = await getOne(`SELECT value FROM settings WHERE key = 'kpi_util_new_grace_months'`);
  const lowThreshold = lowThrRow && lowThrRow.value != null ? Number(lowThrRow.value) : 0.20;
  const graceMonths = graceRow && graceRow.value != null ? Number(graceRow.value) : 6;

  // 立ち上げ期判定の基準日 (今日) と grace 期間の起点
  const now = new Date();
  const graceCutoff = new Date(now.getFullYear(), now.getMonth() - graceMonths, now.getDate());

  let normalWeightSum = 0;
  let normalWeightedRate = 0;

  for (const r of utilClassRows) {
    const programName = (r.program_name as string | null) ?? '';
    const avgRate = Number(r.avg_rate ?? 0);
    const cnt = Number(r.cnt ?? 0);
    const ov = overrideMap.get(programName);

    // 優先順位: excluded > new > watch > normal
    // 1) excluded: program_name === 'イベント' または override.category === 'exclude'
    if (programName === 'イベント' || ov?.category === 'exclude') continue;
    // 2) new(立ち上げ期): override.category === 'new'、または launched_at が grace_months 以内
    const launchedAt = ov?.launched_at ?? null;
    const isNewByDate = !!launchedAt && new Date(launchedAt) >= graceCutoff;
    if (ov?.category === 'new' || (ov?.category == null && isNewByDate)) continue;
    // override.category === 'normal' は強制的に通常 (自動watch判定を上書き)
    if (ov?.category === 'normal') {
      normalWeightSum += cnt;
      normalWeightedRate += avgRate * cnt;
      continue;
    }
    // 3) watch(要対策): override.category === 'watch'、または avg_rate < low_threshold
    if (ov?.category === 'watch' || avgRate < lowThreshold) continue;
    // 4) normal(通常)
    normalWeightSum += cnt;
    normalWeightedRate += avgRate * cnt;
  }

  return normalWeightSum > 0 ? normalWeightedRate / normalWeightSum : 0;
}

// ============================================================
// 月次ファイナンス(売上・収益性) — 正準集計
// ============================================================
//
// もともと `/api/staff/kpi/dashboard` の route 内にSQLと派生計算が直書きされており、
// 週次経営レポート(WS AB)が同じ数字を出すには丸ごとコピペするしかなかった。
// コピペすると「insightsの営業利益」と「メールの営業利益」が将来ズレる
// (TAROの経営判断が2つの違う数字を見ることになる)ため、ここに1本化して
// dashboard route / 週次レポートの両方がこれを呼ぶ。
//
// 定義は移設前と完全に同一(SQL・フォールバック・除外カテゴリすべて)。

/** payroll_runs / studio_billing_runs の確定/暫定を1行で取るSQL。 */
const RUN_TOTAL_SQL = (table: string) =>
  `SELECT
     COALESCE(SUM(CASE WHEN status IN ('confirmed','paid') THEN total_amount END), 0) AS confirmed_total,
     COALESCE(SUM(CASE WHEN status = 'draft' THEN total_amount END), 0) AS draft_total,
     COALESCE(SUM(CASE WHEN status IN ('confirmed','paid') THEN 1 ELSE 0 END), 0) AS confirmed_cnt,
     COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_cnt
   FROM ${table} WHERE year_month = ?`;

/**
 * P3: 確定(confirmed/paid)があればそれを採用。無ければ draft 合計を「暫定」として使う。
 * draft しか無い月を0円扱いにすると経費が丸ごと消えて大幅黒字に見え、混入より危険なため。
 */
export function pickRunTotal(row: Row | null): { total: number; provisional: boolean } {
  const confirmedCnt = n(row?.confirmed_cnt);
  if (confirmedCnt > 0) return { total: n(row?.confirmed_total), provisional: false };
  const draftCnt = n(row?.draft_cnt);
  return { total: n(row?.draft_total), provisional: draftCnt > 0 };
}

/** 経費の表示バケット。既知カテゴリ以外は「その他」へ寄せる。 */
export function bucketExpenses(rows: Array<{ category?: unknown; t?: unknown }>): Record<string, number> {
  const out: Record<string, number> = { 広告費: 0, システム費: 0, 通信費: 0, 備品: 0, その他: 0 };
  for (const e of rows) {
    const cat = String(e.category ?? '');
    if (cat in out) out[cat] = n(e.t);
    else out.その他 += n(e.t);
  }
  return out;
}

export type MonthlyFinance = {
  revenue: {
    core: number;
    breakdown: Record<string, number>;
    data_available: boolean;
  };
  aux_revenue: {
    merch_orders: number;
    video_preorders_estimate: number;
    video_preorder_count: number;
  };
  profitability: {
    revenue: number;
    payroll: number;
    studio: number;
    expense_breakdown: Record<string, number>;
    total_expenses: number;
    operating_profit: number;
    profit_margin: number;
    source_availability: { revenue: boolean; payroll: boolean; studio: boolean; expenses: boolean };
    missing_sources: string[];
    profit_confirmed: boolean;
    payroll_provisional: boolean;
    studio_provisional: boolean;
    provisional_sources: string[];
  };
};

/**
 * 指定月の売上・補助売上・収益性をまとめて取得(正準)。ym='YYYY-MM'。
 * 各クエリは独立なので Promise.all で1往復ぶんに畳む(dashboard の性能特性を維持)。
 */
export async function getMonthlyFinance(ym: string): Promise<MonthlyFinance> {
  const [y, m] = splitYm(ym);
  const lastDay = new Date(y, m, 0).getDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const monthEndISO = `${monthEnd}T23:59:59`;

  const [
    billingRows,
    merchTotalRow,
    videoSettings,
    videoCountRow,
    payrollTotalRow,
    studioTotalRow,
    paymentFeeRow,
    expensesByCategory,
    billingCountRow,
    payrollCountRow,
    studioCountRow,
    expenseCountRow,
  ] = await Promise.all([
    safeAll(
      `SELECT product_category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
       FROM hacomono_billing_records
       WHERE billing_date BETWEEN ? AND ?
       GROUP BY product_category`,
      [monthStart, monthEnd]
    ),
    // P4: 単価は注文時点に固定した unit_price を優先。未設定の過去行のみ現在価格へフォールバック。
    safeOne(
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
    // P3: 未確定(draft)のrunは仮値なので確定分と分けて取る。
    safeOne(RUN_TOTAL_SQL('payroll_runs'), [ym]),
    safeOne(RUN_TOTAL_SQL('studio_billing_runs'), [ym]),
    // 決済手数料(hacomono売上に付随・fee_amountは税込)。売上はgross計上なので
    // 手数料を経費に立てないと営業利益が過大になる(2026-08-29 TARO承認の総額主義)。
    safeOne(
      `SELECT COALESCE(SUM(fee_amount), 0) AS total, SUM(CASE WHEN fee_amount IS NULL AND payment_method = 'カード決済' THEN 1 ELSE 0 END) AS pending
       FROM hacomono_billing_records WHERE billing_date BETWEEN ? AND ?`,
      [monthStart, monthEnd]
    ),
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
  ]);

  const revenueBreakdown: Record<string, number> = { plan: 0, ticket: 0, enrollment_fee: 0, other: 0 };
  for (const r of billingRows) {
    const cat = (r.product_category as string | null) ?? 'other';
    revenueBreakdown[cat] = n(r.total);
  }
  const coreRevenue = revenueBreakdown.plan + revenueBreakdown.ticket + revenueBreakdown.enrollment_fee;

  const payroll = pickRunTotal(payrollTotalRow);
  const studio = pickRunTotal(studioTotalRow);
  const provisionalSources = [
    ...(payroll.provisional ? ['給与'] : []),
    ...(studio.provisional ? ['スタジオ料'] : []),
    ...(n(paymentFeeRow?.pending) > 0 ? [`決済手数料(未確定${n(paymentFeeRow?.pending)}件)`] : []),
  ];
  const expBreakdown = bucketExpenses(expensesByCategory as Array<{ category?: unknown; t?: unknown }>);
  const paymentFees = n(paymentFeeRow?.total);
  if (paymentFees > 0) expBreakdown['決済手数料'] = (expBreakdown['決済手数料'] ?? 0) + paymentFees;
  const totalExpenses =
    payroll.total + studio.total + Object.values(expBreakdown).reduce((a, b) => a + b, 0);
  const operatingProfit = coreRevenue - totalExpenses;

  const sourceAvailability = {
    revenue: n(billingCountRow?.c) > 0,
    payroll: n(payrollCountRow?.c) > 0,
    studio: n(studioCountRow?.c) > 0,
    expenses: n(expenseCountRow?.c) > 0,
  };
  const missingSources = Object.entries(sourceAvailability)
    .filter(([, ok]) => !ok)
    .map(([k]) => ({ revenue: '売上(課金)', payroll: '給与', studio: 'スタジオ料', expenses: '経費' }[k] ?? k));

  const videoCount = n(videoCountRow?.n);
  const videoPrice = n(videoSettings?.value);

  return {
    revenue: {
      core: coreRevenue,
      breakdown: revenueBreakdown,
      data_available: billingRows.length > 0,
    },
    aux_revenue: {
      merch_orders: n(merchTotalRow?.total),
      video_preorders_estimate: videoCount * videoPrice,
      video_preorder_count: videoCount,
    },
    profitability: {
      revenue: coreRevenue,
      payroll: payroll.total,
      studio: studio.total,
      expense_breakdown: expBreakdown,
      total_expenses: totalExpenses,
      operating_profit: operatingProfit,
      profit_margin: coreRevenue > 0 ? (operatingProfit / coreRevenue) * 100 : 0,
      source_availability: sourceAvailability,
      missing_sources: missingSources,
      profit_confirmed: missingSources.length === 0,
      payroll_provisional: payroll.provisional,
      studio_provisional: studio.provisional,
      provisional_sources: provisionalSources,
    },
  };
}
