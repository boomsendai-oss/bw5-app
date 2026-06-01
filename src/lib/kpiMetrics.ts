import { getOne } from './db';

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
        AND (withdrew_at IS NULL OR withdrew_at > ?)`,
    [monthEndISO, monthEndISO]
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
