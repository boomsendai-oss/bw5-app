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

function toYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// GET /api/staff/kpi/trends?months=6
// 過去 N ヶ月 (現在月含む) の主要KPIトレンドを返す
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const monthsParam = Number(url.searchParams.get('months') ?? '6');
  const months = Math.min(Math.max(monthsParam, 1), 24);

  // LINE友だちは履歴がないので現在値を全月共通で入れる
  const lineFriendsNow = n((await safeOne(
    `SELECT COUNT(*) AS n FROM lstep_friends WHERE blocked = 0`,
  ))?.n);

  const now = new Date();
  const monthsArr: string[] = [];
  const revenue: number[] = [];
  const membersActive: number[] = [];
  const lineFriends: number[] = [];
  const churnRate: number[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = toYM(d);
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthStart = `${ym}-01`;
    const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;
    const monthEndISO = `${monthEnd}T23:59:59`;

    const startActive = n((await safeOne(
      `SELECT COUNT(*) AS n FROM boom_members
       WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
         AND (withdrew_at IS NULL OR withdrew_at > ?)`,
      [monthStart, monthStart],
    ))?.n);
    const endActive = n((await safeOne(
      `SELECT COUNT(*) AS n FROM boom_members
       WHERE (enrolled_at IS NULL OR enrolled_at <= ?)
         AND (withdrew_at IS NULL OR withdrew_at > ?)`,
      [monthEnd, monthEnd],
    ))?.n);
    const churned = n((await safeOne(
      `SELECT COUNT(*) AS n FROM boom_members WHERE withdrew_at BETWEEN ? AND ?`,
      [monthStart, monthEndISO],
    ))?.n);
    const rate = startActive > 0 ? (churned / startActive) * 100 : 0;

    const billingRows = await safeAll(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM hacomono_billing_records
       WHERE billing_date BETWEEN ? AND ?
         AND product_category IN ('plan','ticket','enrollment_fee')`,
      [monthStart, monthEnd],
    );
    const rev = billingRows.length > 0 ? n(billingRows[0].total) : 0;

    monthsArr.push(ym);
    revenue.push(rev);
    membersActive.push(endActive);
    lineFriends.push(lineFriendsNow);
    churnRate.push(Number(rate.toFixed(2)));
  }

  return NextResponse.json({
    months: monthsArr,
    revenue,
    members_active: membersActive,
    line_friends: lineFriends,
    churn_rate: churnRate,
    generated_at: new Date().toISOString(),
  });
}
