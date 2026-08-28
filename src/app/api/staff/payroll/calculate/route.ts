import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { recalcPayroll } from '@/lib/monthlyClose';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/payroll/calculate { year_month: 'YYYY-MM' }
// 本体は src/lib/monthlyClose.ts (自動実行 /api/cron/monthly-close と共通)。
// draftを作るところまで。確定・明細配布・振込CSVは人間のゲートのまま。
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = body.year_month as string | undefined;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month is required (YYYY-MM)' }, { status: 400 });
  }
  return NextResponse.json(await recalcPayroll(ym));
}
