import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { syncTrialCalendar, ensureTrialCalendar } from '@/lib/trialCalendar';
import { getCalendarClient } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/trials/calendar-sync
// 体験予約を「体験予約（スタッフ用・非公開）」カレンダーへ今すぐ同期する(普段は体験予約取込の最後に自動で走る)。
// body.share_to (任意) = 閲覧者として共有するGoogleアカウント。公開(default/全員)の共有はしない。
// ※メールアドレスはURLに載せない(ログに残るため)。bodyで受ける。
export const POST = withAuth(async (req: NextRequest) => {
  let shareTo = '';
  try {
    const body = (await req.json()) as { share_to?: string };
    shareTo = (body.share_to ?? '').trim();
  } catch {
    // body無し = 同期だけ
  }
  let shared: string | null = null;
  if (shareTo) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(shareTo)) {
      return NextResponse.json({ ok: false, error: 'share_to がメールアドレスの形ではありません' }, { status: 400 });
    }
    const calendarId = await ensureTrialCalendar();
    const cal = await getCalendarClient();
    await cal.acl.insert({
      calendarId,
      sendNotifications: true,
      requestBody: { role: 'reader', scope: { type: 'user', value: shareTo } },
    });
    shared = 'reader';
  }
  const result = await syncTrialCalendar();
  return NextResponse.json({ ...result, shared });
});
