import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { syncBlockEvents, isConnected, ensureBlockCalendar } from '@/lib/googleCalendar';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET  /api/staff/schedule/sync-google-calendar  → 連携状態とカレンダーIDを返す
// POST /api/staff/schedule/sync-google-calendar?months=3 → 休講を所有カレンダーへ同期
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const connected = await isConnected();
  let calendarId: string | null = null;
  if (connected) {
    const row = await getOne('SELECT value FROM settings WHERE key = ?', ['block_calendar_id']);
    calendarId = (row?.value as string | undefined) ?? null;
  }
  return NextResponse.json({ connected, calendarId });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  if (!(await isConnected())) {
    return NextResponse.json({ error: 'Googleカレンダー未連携です。先に「Google連携」してください' }, { status: 400 });
  }
  const months = parseInt(new URL(req.url).searchParams.get('months') ?? '3', 10);
  try {
    await ensureBlockCalendar();
    const result = await syncBlockEvents(Number.isFinite(months) ? months : 3);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `同期失敗: ${msg}` }, { status: 500 });
  }
}
