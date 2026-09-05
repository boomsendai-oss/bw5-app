import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isConnected, listLessonEvents } from '@/lib/googleCalendar';
import {
  addDaysYmd,
  buildDailyPostParts,
  jstMidnightUtcIso,
} from '@/lib/xWeeklySchedule';
import { validateThreadsText } from '@/lib/threadsPosts';
import { decideImmediatePublish, publishThreadsPostNow, publishXPostNow } from '@/lib/xDailyPublish';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 「本日のレッスン」X/Threads投稿の自動生成cron (2026-08-07・TARO指示)。
// GitHub Actions から毎日12:00 JSTに叩かれ、当日分を12:30 JST予約で投入する。
// (12:30の根拠: 保護者の昼休みスクロール帯・夕方レッスンの6時間前リマインド・IGストーリー12時と整合。
//  直前生成なので朝に入った休講・代講もその日の投稿に反映される。2026-08-07 TARO指摘で7:30から変更)
// 層0(カレンダー由来・型固定)なので approved 直接投入=TARO承認不要(SNSテキスト配信 設計の承認3層)。
// Threads側は x_post_id リンクの draft を作る(threads-autopost の承認追従が approved にする)。
// 予定の正 = 生徒に公開しているGoogleカレンダー(週次と同じ・アプリDBは読まない)。
// ⚠️ 認証: withAuthではなくCRON_SECRET(fail-closed)。GH Actionsから叩くため(x-autopostと同パターン)
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
    return NextResponse.json({ ok: true, status: 'dormant', note: 'Googleカレンダー未連携のためスキップ' });
  }

  // 今日(JST)の日付
  const j = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const ymd = j.toISOString().slice(0, 10);
  const today = { month: j.getUTCMonth() + 1, day: j.getUTCDate(), weekday: j.getUTCDay() };
  const marker = `【本日のレッスン】${today.month}/${today.day}(`;

  const dup = await getOne(
    "SELECT id FROM x_posts WHERE parts LIKE ? AND status IN ('draft','approved','posting','posted')",
    [`%${marker}%`]
  );
  if (dup) {
    return NextResponse.json({ ok: true, skipped: 'already-exists', day: ymd, existingId: dup.id });
  }

  const events = await listLessonEvents(jstMidnightUtcIso(ymd), jstMidnightUtcIso(addDaysYmd(ymd, 1)));
  if (events === null) {
    return NextResponse.json({ ok: false, skipped: 'lesson-calendar-not-found' });
  }
  const parts = buildDailyPostParts(events, today);
  if (!parts) {
    return NextResponse.json({ ok: true, skipped: 'no-lessons', day: ymd, events: events.length });
  }

  // 予約 = 当日 12:30 JST。層0なので approved 直接投入。
  // ⚠️ GH Actionsのcronはこのリポで大きく遅れる(2026-09-05実測: 生成=16〜18時、投稿cron=3〜5時間毎)。
  // 別cronの投稿を待つと2時間の猶予に間に合わず未投稿になる(9/2〜9/4の3日連続)ので、
  // 生成時刻が10:30〜20:30なら**この場で投稿**する。20:30を過ぎていたら見送り(夜に流しても遅い)。
  const decision = decideImmediatePublish(j.getUTCHours(), j.getUTCMinutes());
  if (decision === 'too-late') {
    return NextResponse.json({ ok: true, skipped: 'too-late', day: ymd, note: '生成が20:30 JSTより後だったため本日分は見送り', events: events.length });
  }
  const preferred = new Date(`${ymd}T12:30:00+09:00`).getTime();
  const floor = Date.now() + 2 * 60 * 1000;
  const scheduledAt = decision === 'post-now' ? new Date().toISOString() : new Date(Math.max(preferred, floor)).toISOString();
  const rx = await execute(
    "INSERT INTO x_posts (account, parts, scheduled_at, status) VALUES ('boom', ?, ?, 'approved')",
    [JSON.stringify(parts), scheduledAt]
  );
  const xId = Number(rx.lastInsertRowid);

  // Threads側: 全partsを結合して1本(500字以内のときだけ)。リンク行=承認追従でapprovedになる
  let threadsId: number | null = null;
  const joined = parts.join('\n\n');
  if (validateThreadsText(joined) === null) {
    const rt = await execute(
      "INSERT INTO threads_posts (x_post_id, text, scheduled_at, status) VALUES (?, ?, ?, 'draft')",
      [xId, joined, scheduledAt]
    );
    threadsId = Number(rt.lastInsertRowid);
  }

  if (decision === 'post-now') {
    const x = await publishXPostNow(xId);
    const t = threadsId !== null ? await publishThreadsPostNow(threadsId) : null;
    return NextResponse.json({
      ok: x.ok,
      created: xId,
      threadsId,
      day: ymd,
      events: events.length,
      parts: parts.length,
      published_now: true,
      x: x.ok ? { tweets: x.tweetIds.length } : { error: x.reason },
      threads: t ? (t.ok ? { posted: true } : { error: t.reason, skipped: 'skipped' in t }) : null,
    });
  }

  return NextResponse.json({
    ok: true,
    created: xId,
    threadsId,
    day: ymd,
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
