import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { confirmMonth, unconfirmMonth, getMonthConfirmation } from '@/lib/monthConfirm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 月の確定/凍結 (Phase2 ①)
//
// GET    /api/staff/schedule/confirm?year=YYYY&month=MM  確定状態を返す
// POST   /api/staff/schedule/confirm   body:{year,month,note?}  確定(materialize)
// DELETE /api/staff/schedule/confirm?year=YYYY&month=MM  確定解除(master再同期)

/** year/month を 'YYYY-MM' に整形。不正なら null。 */
function toYearMonth(yearRaw: unknown, monthRaw: unknown): string | null {
  const y = Number(yearRaw);
  const m = Number(monthRaw);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = toYearMonth(url.searchParams.get('year'), url.searchParams.get('month'));
  if (!ym) return NextResponse.json({ error: 'invalid year/month' }, { status: 400 });
  const info = await getMonthConfirmation(ym);
  return NextResponse.json({
    year_month: ym,
    confirmed: !!info,
    confirmed_at: info?.confirmed_at ?? null,
    materialized_count: info?.materialized_count ?? 0,
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = toYearMonth(body.year, body.month);
  if (!ym) return NextResponse.json({ error: 'invalid year/month' }, { status: 400 });
  const { created, alreadyConfirmed } = await confirmMonth(ym, typeof body.note === 'string' ? body.note : undefined);
  return NextResponse.json({ ok: true, year_month: ym, confirmed: true, created, alreadyConfirmed });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = toYearMonth(url.searchParams.get('year'), url.searchParams.get('month'));
  if (!ym) return NextResponse.json({ error: 'invalid year/month' }, { status: 400 });
  await unconfirmMonth(ym);
  return NextResponse.json({ ok: true, year_month: ym, confirmed: false });
}
