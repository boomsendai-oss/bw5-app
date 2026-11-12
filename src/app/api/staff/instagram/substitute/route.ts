import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { execute } from '@/lib/db';
import { todayJst, weekdayJst, nowUtcIso } from '@/lib/dateJst';
import { planSubstitutes, loadSubstitutes, resolveMentions } from '@/lib/storyPlan';
import { isAllowedSubstituteUrl } from '@/lib/storySubstitute';
import { notifyTaro } from '@/lib/notify';
import { LEGACY_ORIGIN } from '@/lib/appOrigin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 代講版ストーリーの受け口(TARO 2026-11-11)。呼ぶのは M1 の boom-events-hub/scripts/story_substitute。
//   GET  ?date=YYYY-MM-DD  … その日に代講版を作るべき素材と、誰から誰へ替わるか(+登録済みの代講版)
//   POST {date, replacesBase, mediaUrl, lessons, swaps?, note?}  … 作った代講版を登録(その日の投稿で使われる)
//   POST {action:'cancel', date, replacesBase}                  … 登録を取り消す
//   POST {action:'notify', title, message}                       … 自動で出せなかった理由をTAROへ通知
// 認証: 管理パスワード(x-admin-password)またはスタッフのログイン。

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ORIGIN = LEGACY_ORIGIN;

export const GET = withAuth(async (req: NextRequest) => {
  const date = req.nextUrl.searchParams.get('date') ?? '';
  if (!ISO.test(date)) return NextResponse.json({ error: 'date=YYYY-MM-DD が必要です' }, { status: 400 });
  try {
    const plan = await planSubstitutes(ORIGIN, date, weekdayJst(date));
    const registered = await loadSubstitutes(date);
    // 代講に入る講師のインスタ名が講師マスタに無いと、メンションが付かない。無い時は自動で出さない
    const items = await Promise.all(
      plan.items.map(async (i) => ({
        ...i,
        unresolvedMentions: (await resolveMentions(i.swaps.map((s) => s.to))).unresolved,
      }))
    );
    return NextResponse.json({ ok: true, date, weekday: weekdayJst(date), ...plan, items, registered });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});

export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid json' }, { status: 400 });

  if (body.action === 'notify') {
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : '';
    const message = typeof body.message === 'string' ? body.message.slice(0, 1500) : '';
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    try {
      await notifyTaro({ subjectPrefix: '[BOOM ストーリー代講]', subject: title, body: message });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  const date = String(body.date ?? '');
  const replacesBase = String(body.replacesBase ?? '').trim();
  if (!ISO.test(date) || !replacesBase) {
    return NextResponse.json({ error: 'date と replacesBase が必要です' }, { status: 400 });
  }
  if (date < todayJst()) return NextResponse.json({ error: '過去の日付は登録できません' }, { status: 400 });

  if (body.action === 'cancel') {
    await execute(
      "UPDATE story_substitute SET status = 'cancelled', updated_at = ? WHERE date = ? AND replaces_base = ?",
      [nowUtcIso(), date, replacesBase]
    );
    return NextResponse.json({ ok: true, registered: await loadSubstitutes(date) });
  }

  const mediaUrl = String(body.mediaUrl ?? '');
  if (!isAllowedSubstituteUrl(mediaUrl)) {
    return NextResponse.json({ error: '画像のURLが不正です(media.boom-sendai.com の jpg/png のみ)' }, { status: 400 });
  }
  // 登録してよいのは「今のカレンダーで代講と判定される素材」だけ。宣言もサーバー側の判定と一致させる
  // (スクリプトの取り違えや古い判定で、間違った講師の画像を登録しないため)。
  const plan = await planSubstitutes(ORIGIN, date, weekdayJst(date));
  const item = plan.items.find((i) => i.base === replacesBase);
  if (!item) {
    return NextResponse.json({ error: `${date} の ${replacesBase} は今のカレンダーでは代講の対象ではありません` }, { status: 409 });
  }
  const now = nowUtcIso();
  await execute(
    `INSERT INTO story_substitute (date, replaces_base, media_url, lessons, swaps, status, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(date, replaces_base) DO UPDATE SET
       media_url = excluded.media_url, lessons = excluded.lessons, swaps = excluded.swaps,
       status = 'active', note = excluded.note, updated_at = excluded.updated_at`,
    [date, replacesBase, mediaUrl, JSON.stringify(item.substitutedLessons), JSON.stringify(item.swaps),
      body.note ? String(body.note).slice(0, 500) : null, now, now]
  );
  return NextResponse.json({ ok: true, registered: await loadSubstitutes(date) });
});
