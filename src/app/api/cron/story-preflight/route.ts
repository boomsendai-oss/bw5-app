import { NextRequest, NextResponse } from 'next/server';
import { todayJst, weekdayJst, shiftDays } from '@/lib/dateJst';
import { configured } from '@/lib/instagram';
import { fetchLessonsForDate } from '@/lib/lessonCalendar';
import { findChainMediaList, loadSidecar, checkSchedule, resolveMentions } from '@/lib/storyPlan';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/story-preflight
// 前夜 JST 21:00(GH Actions cron)に「明日」の投稿予定を先読みして、落ち着いて直せる時間に予告する。
// dead-man(watchdog=当日朝)が拾えない「素材の中身ズレ」を前夜のうちに surface するのが役割。
//   (1) 明日レッスンがあるのに素材(jpg)が未配置
//   (2) 明日出す素材の宣言レッスンが明日のカレンダーと不一致(=代講/時間変更/曜日テンプレの陳腐化)
//   (3) 宣言講師のIGハンドルが instructors 未登録(=タグが付かない)
// いずれも無ければ無音。通知は notify.ts(メール既定・LINE昇格対応)。
// 認証: post-story と同じく Bearer CRON_SECRET または x-cron-secret(GH Actionsから)。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const bearer = req.headers.get('authorization');
  const xcron = req.headers.get('x-cron-secret');
  if (bearer !== `Bearer ${secret}` && xcron !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!configured()) {
    return NextResponse.json({ ok: true, configured: false });
  }

  const date = shiftDays(todayJst(), 1); // 明日
  const weekday = weekdayJst(date);
  const origin = new URL(req.url).origin;
  const warnings: string[] = [];

  const chain = await findChainMediaList(origin, date, weekday);

  if (chain.length === 0) {
    // 素材が無い。明日カレンダーにレッスンがあるなら「置き忘れ」の疑い。無ければ休講日=無音。
    try {
      const { lessons } = await fetchLessonsForDate(date);
      if (lessons.length > 0) {
        warnings.push(
          `📭 明日 ${date}(${'日月火水木金土'[weekday]}): レッスン${lessons.length}件がカレンダーにあるのに、投稿素材(jpg)が未配置です。`
        );
      }
    } catch {
      // カレンダーが読めない時は前夜は静観(当日朝のwatchdogが拾う)
    }
  } else {
    for (const media of chain) {
      const sidecar = await loadSidecar(origin, media.base);

      const check = await checkSchedule(date, sidecar.lessons);
      if (check.result === 'mismatch') {
        warnings.push(`⚠️ ${media.base}: 宣言レッスンが明日のカレンダーと不一致 — ${check.problems.join(' / ')}`);
      }

      if (sidecar.lessons && sidecar.lessons.length > 0) {
        try {
          const { unresolved } = await resolveMentions(sidecar.lessons.map((l) => l.instructor));
          if (unresolved.length > 0) {
            warnings.push(
              `🏷️ ${media.base}: IGハンドル未登録の講師 [${unresolved.join(', ')}] — このままだとタグが付きません(講師マスタに登録を)。`
            );
          }
        } catch {
          // 解決失敗は前夜は静観
        }
      }
    }
  }

  let notified = false;
  if (warnings.length > 0) {
    try {
      await notifyTaro({
        subject: `前夜チェック 明日 ${date}`,
        body: `明日の自動投稿で気になる点があります(今夜のうちに直せます):\n\n${warnings.join('\n')}`,
      });
      notified = true;
    } catch (e) {
      console.error(`preflight通知失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  return NextResponse.json({ ok: warnings.length === 0, date, slots: chain.length, warnings, notified });
}
