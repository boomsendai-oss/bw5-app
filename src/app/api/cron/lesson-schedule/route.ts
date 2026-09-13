import { NextRequest, NextResponse } from 'next/server';
import { listPrimaryLessonEvents } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/lesson-schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// boom.sendai のプライマリカレンダー(レッスン予定の正本)を読んで返すだけの読み取り専用API。
// 呼び出しは boom-events-hub の GitHub Actions (Lステップのシフト自動同期)。
//
// なぜアプリ側に置くかというと、Googleカレンダーの認証情報がここにあるのと、
// Google に繰り返し予定を展開させたいため。iCal を直接読むと展開を自前で書くことになり、
// 週替わりの書き換え(例: 10/3だけガールズ→WAACK)を取り違える危険がある。
//
// 認証: x-cron-secret または Authorization: Bearer が REPORT_SECRET / CRON_SECRET に一致。
// 未設定なら拒否(無認証公開を防ぐ)。
const MAX_RANGE_DAYS = 180;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function authorized(req: NextRequest): boolean {
  const secrets = [process.env.REPORT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') ?? '';
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json({ ok: false, error: 'from/to は YYYY-MM-DD で指定してください' }, { status: 400 });
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!(days > 0) || days > MAX_RANGE_DAYS) {
    return NextResponse.json({ ok: false, error: `期間は1〜${MAX_RANGE_DAYS}日で指定してください` }, { status: 400 });
  }

  try {
    const { calendarId, events } = await listPrimaryLessonEvents(
      `${from}T00:00:00+09:00`,
      `${to}T00:00:00+09:00`,
    );
    return NextResponse.json({ ok: true, calendarId, from, to, count: events.length, events });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
