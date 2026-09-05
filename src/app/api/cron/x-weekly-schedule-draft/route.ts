import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isConnected, listLessonEvents } from '@/lib/googleCalendar';
import {
  addDaysYmd,
  buildWeeklyPostParts,
  jstMidnightUtcIso,
  postMondayJst,
} from '@/lib/xWeeklySchedule';
import { decideWeeklyImmediatePublish, publishXPostNow } from '@/lib/xDailyPublish';
import { chooseGreeting, recordGreetingUse } from '@/lib/greetingUse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 「今週のレッスン」X投稿の自動生成cron (2026-07-17・WS S)。
// GitHub Actions から毎週日曜21時JSTに叩かれる。
// 予定の正 = 生徒に公開しているGoogleカレンダー「BOOMレッスンスケジュール」(アプリDBは読まない)。
// 2026-08-06より層0扱い=approvedで直接投入(TARO承認不要・SNSテキスト配信 設計v0.6の承認3層)。
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

  const monday = postMondayJst(); // YYYY-MM-DD (JST)。月曜当日なら今日(当週)
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
  const greeting = await chooseGreeting({ ymd: monday, weekly: true, count: events.length });
  const parts = buildWeeklyPostParts(events, weekStart, weekEnd, { greeting: greeting?.text });
  if (!parts) {
    return NextResponse.json({ ok: true, skipped: 'no-lessons', week: monday, events: events.length });
  }

  // 層0(事実がDB/カレンダー由来・型固定)なので承認不要で直接 approved にする
  // (SNSテキスト配信 設計v0.6の承認3層・2026-08-06 TARO再確認「この辺は承認しなくてもいい」)
  //
  // 2026-09-05〜: 生成cronは月曜07:00 JST(+予備08:30)。GH Actionsのcronがこのリポで数時間遅れ、
  // 投稿cron(x-autopost)も3〜5時間毎にしか回らず「月曜8:00予約→2時間猶予切れ」で落ちるリスクがあるため、
  // 月曜の06:30〜12:00に生成されたら**その場で投稿**する(日次「本日のレッスン」と同じ方式)。
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const decision = decideWeeklyImmediatePublish(jst.getUTCDay() === 1, jst.getUTCHours(), jst.getUTCMinutes());
  const scheduledAt = decision === 'post-now' ? new Date().toISOString() : new Date(`${monday}T08:00:00+09:00`).toISOString();
  const r = await execute(
    "INSERT INTO x_posts (account, parts, scheduled_at, status) VALUES ('boom', ?, ?, 'approved')",
    [JSON.stringify(parts), scheduledAt]
  );
  const createdId = Number(r.lastInsertRowid);
  if (greeting) await recordGreetingUse(greeting.id, monday);

  if (decision === 'post-now') {
    const x = await publishXPostNow(createdId);
    return NextResponse.json({
      ok: x.ok,
      created: createdId,
      week: monday,
      events: events.length,
      parts: parts.length,
      published_now: true,
      x: x.ok ? { tweets: x.tweetIds.length } : { error: x.reason },
    });
  }

  return NextResponse.json({
    ok: true,
    created: createdId,
    week: monday,
    events: events.length,
    parts: parts.length,
    scheduledAt,
    published_now: false,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
