import { getOne, getAll } from './db';

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
