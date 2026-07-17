import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isConnected, listLessonEvents } from '@/lib/googleCalendar';
import {
  addDaysYmd,
  buildWeeklyPostParts,
  jstMidnightUtcIso,
  nextMondayJst,
} from '@/lib/xWeeklySchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 「今週のレッスン」X投稿の下書き自動生成cron (2026-07-17・WS S)。
// GitHub Actions から毎週日曜21時JSTに叩かれる。
// 予定の正 = 生徒に公開しているGoogleカレンダー「BOOMレッスンスケジュール」(アプリDBは読まない)。
// 生成するのは x_posts の draft のみ — 投稿にはTAROの承認(/staff/x-posts)が必要。
// 予約時刻 = 翌月曜 8:00 JST。同じ週の下書きが既にあれば二重生成しない。
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isConnected())) {
    return NextResponse.json({ ok: false, skipped: 'google-not-connected' });
  }

  const monday = nextMondayJst(); // YYYY-MM-DD (JST)
  const sunday = addDaysYmd(monday, 6);
  const weekMarker = `【今週のレッスン】${Number(monday.slice(5, 7))}/${Number(monday.slice(8, 10))}(月)`;

  // 二重生成ガード: 同じ週ヘッダーを持つ下書き/承認済みが既にあればスキップ
  const dup = await getOne(
    "SELECT id FROM x_posts WHERE parts LIKE ? AND status IN ('draft','approved','posting','posted')",
    [`%${weekMarker}%`]
  );
  if (dup) {
    return NextResponse.json({ ok: true, skipped: 'already-exists', week: monday, existingId: dup.id });
  }

  const events = await listLessonEvents(jstMidnightUtcIso(monday), jstMidnightUtcIso(addDaysYmd(monday, 7)));
  if (events === null) {
    return NextResponse.json({ ok: false, skipped: 'lesson-calendar-not-found' });
  }

  const weekStart = { month: Number(monday.slice(5, 7)), day: Number(monday.slice(8, 10)) };
  const weekEnd = { month: Number(sunday.slice(5, 7)), day: Number(sunday.slice(8, 10)) };
  const parts = buildWeeklyPostParts(events, weekStart, weekEnd);
  if (!parts) {
    return NextResponse.json({ ok: true, skipped: 'no-lessons', week: monday, events: events.length });
  }

  // 予約 = 月曜 8:00 JST (= 前日 23:00 UTC)
  const scheduledAt = new Date(`${monday}T08:00:00+09:00`).toISOString();
  const r = await execute(
    "INSERT INTO x_posts (account, parts, scheduled_at, status) VALUES ('boom', ?, ?, 'draft')",
    [JSON.stringify(parts), scheduledAt]
  );

  return NextResponse.json({
    ok: true,
    created: Number(r.lastInsertRowid),
    week: monday,
    events: events.length,
    parts: parts.length,
    scheduledAt,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
