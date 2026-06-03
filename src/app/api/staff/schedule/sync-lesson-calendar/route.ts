import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { syncLessons, ensureLessonCalendar, isConnected } from '@/lib/googleCalendar';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET  /api/staff/schedule/sync-lesson-calendar  → 連携状態・カレンダーID・公開URLを返す
// POST /api/staff/schedule/sync-lesson-calendar?months=3 → 全レッスンを公開カレンダーへ同期
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const connected = await isConnected();
  let calendarId: string | null = null;
  let embedUrl: string | null = null;
  if (connected) {
    const row = await getOne('SELECT value FROM settings WHERE key = ?', ['lesson_calendar_id']);
    calendarId = (row?.value as string | undefined) ?? null;
    if (calendarId) {
      embedUrl = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}&ctz=Asia%2FTokyo`;
    }
  }
  return NextResponse.json({ connected, calendarId, embedUrl });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  if (!(await isConnected())) {
    return NextResponse.json({ error: 'Googleカレンダー未連携です。先に「Google連携」してください' }, { status: 400 });
  }
  const sp = new URL(req.url).searchParams;
  const months = parseInt(sp.get('months') ?? '3', 10);
  const startYm = sp.get('start') ?? undefined; // 'YYYY-MM' 指定で過去月も同期可(検証用)
  try {
    await ensureLessonCalendar();
    const result = await syncLessons(Number.isFinite(months) ? months : 3, startYm);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `レッスン同期失敗: ${msg}` }, { status: 500 });
  }
}
