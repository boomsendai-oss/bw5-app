import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { syncCalendarActuals } from '@/lib/calendarSync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/calendar-actuals/sync { year_month, apply?, allow_next_month? }
// Googleカレンダー(正本)の実績を lesson_instances へ反映する。**apply を付けない限り書かない**。
// 本体は src/lib/calendarSync.ts (自動実行 /api/cron/monthly-close と共通)。
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = body.year_month as string | undefined;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month is required (YYYY-MM)' }, { status: 400 });
  }
  try {
    // allow_next_month: 翌月を同期する(前払いスタジオの翌月分を算定するため・手動実行用)
    const r = await syncCalendarActuals(ym, { apply: body.apply === true, allowNextMonth: body.allow_next_month === true });
    if (r.skippedReason) return NextResponse.json({ ...r, error: r.skippedReason }, { status: 409 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json(
      { error: `同期に失敗: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }
}
