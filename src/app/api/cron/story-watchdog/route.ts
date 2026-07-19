import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { todayJst, weekdayJst } from '@/lib/dateJst';
import { configured, connectionStatus, refreshTokenIfStale } from '@/lib/instagram';
import { findChainMediaList, loadSidecar, checkSchedule } from '@/lib/storyPlan';
import { notifyTaro } from '@/lib/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/story-watchdog
// GitHub Actions とは別の故障ドメイン(Vercel Cron)で毎朝 JST~9:10 に走る監視役。
// 役割は3つ、いずれも「投稿はしない(notify-only)」:
//   (1) トークン延命: refreshTokenIfStale を無条件で呼ぶ(投稿が起きない日でも60日失効を防ぐ)。
//   (2) dead-man: 「素材はあるのに未投稿」を検知して TARO に1通だけ通知(自己修復・再投稿はしない)。
//        →トリガー不発(#1)・mismatchスキップ・タグ劣化・投稿エラーを1つの網で拾う。
//   (3) ハートビート: HEALTHCHECKS_URL 設定時、watchdog自身の生存を外部へ通知。
//        通知が必要なのに送れなかった場合は success ping を打たない(=外部が沈黙を検知)。
// 全て正常なら無音。素材が無い日(火曜など)も無音。
//
// 認証: sync-lesson-calendar と同じ CRON_SECRET(Vercelが Authorization: Bearer で送る)。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const anomalies: string[] = [];

  // (1) トークン延命(無条件)。投稿が走らない日でも呼ばれるのが肝。
  try {
    await refreshTokenIfStale();
  } catch (e) {
    anomalies.push(`⚠️ Instagramトークン更新に失敗: ${e instanceof Error ? e.message : e}(60日失効の恐れ・要再連携確認)`);
  }
  try {
    const cs = await connectionStatus();
    if (cs.connected && typeof cs.tokenAgeDays === 'number' && cs.tokenAgeDays > 50) {
      anomalies.push(`⚠️ Instagramトークンが${cs.tokenAgeDays}日経過(60日で失効)。更新が繰り返し失敗している可能性。`);
    }
  } catch {
    // connectionStatus失敗は致命ではない
  }

  if (!configured()) {
    // env未設定(投稿系がno-op)の間はdead-man対象外。トークン警告だけ出す。
    if (anomalies.length > 0) await safeNotify('設定未完了', anomalies);
    return NextResponse.json({ ok: true, configured: false, anomalies });
  }

  const date = todayJst();
  const weekday = weekdayJst(date);

  // 壁時計ガード: JST 9時前は「未投稿」を判定しない(GH cron 7:52-8:32 の着地待ち+Hobby cronの早発ゆらぎ対策)。
  const jstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  const deadmanActive = jstHour >= 9;

  let expectedCount = 0;
  let postedCount = 0;

  if (deadmanActive) {
    const origin = new URL(req.url).origin;
    const expected = await findChainMediaList(origin, date, weekday);
    expectedCount = expected.length;

    if (expected.length > 0) {
      const rows = await getAll(
        'SELECT video_path, status, error FROM story_post_log WHERE date = ?',
        [date]
      );
      const byPath = new Map<string, Array<{ status: string; error: string | null }>>();
      for (const r of rows) {
        const p = String(r.video_path);
        if (!byPath.has(p)) byPath.set(p, []);
        byPath.get(p)!.push({ status: String(r.status), error: r.error ? String(r.error) : null });
      }

      let attemptedAny = false;
      for (const media of expected) {
        const logs = byPath.get(media.url) ?? [];
        if (logs.length > 0) attemptedAny = true;
        const posted = logs.some((l) => l.status === 'posted');
        if (posted) {
          postedCount++;
          continue;
        }
        const mismatch = logs.find((l) => l.status === 'skipped_schedule_mismatch');
        const errored = logs.find((l) => l.status === 'error');
        if (mismatch) {
          anomalies.push(`❌ ${media.base}: スケジュール不一致で未投稿 — ${mismatch.error ?? ''}`);
        } else if (errored) {
          anomalies.push(`❌ ${media.base}: 投稿エラー — ${errored.error ?? ''}`);
        } else {
          // ログ行が無い=cronがこの素材を一度も処理していない
          const sc = await checkSchedule(date, (await loadSidecar(origin, media.base)).lessons).catch(() => null);
          const hint =
            sc && sc.result === 'mismatch'
              ? `(照合: ${sc.problems.join(' / ')})`
              : '(cronが起動していない疑い)';
          anomalies.push(`❌ ${media.base}: 未投稿 ${hint}`);
        }
      }

      // タグ劣化(mentions_failed列がある場合のみ・防御的)
      try {
        const tagRows = await getAll(
          "SELECT video_path, mentions_failed FROM story_post_log WHERE date = ? AND status = 'posted' AND mentions_failed IS NOT NULL AND mentions_failed != '' AND mentions_failed != '[]'",
          [date]
        );
        for (const t of tagRows) {
          anomalies.push(`△ ${String(t.video_path).split('/').pop()}: タグ付け一部失敗 — ${t.mentions_failed}`);
        }
      } catch {
        // mentions_failed列が未適用(migration前)なら無視
      }

      if (!attemptedAny && postedCount === 0) {
        anomalies.unshift(`🚨 本日 ${date}: 素材${expected.length}件があるのに投稿ログが1件も無い(GH Actions cron未発火の疑い)。`);
      }
    }
  }

  let notifySucceeded = true;
  if (anomalies.length > 0) {
    notifySucceeded = await safeNotify(`要対応 ${date}`, anomalies);
  }

  // (3) ハートビート: 正常 or (異常ありかつ通知成功) の時だけ success ping。
  //     通知が必要なのに送れなかった時は打たない=外部サービスが沈黙を検知。
  const hc = process.env.HEALTHCHECKS_URL;
  if (hc && (anomalies.length === 0 || notifySucceeded)) {
    await fetch(hc, { method: 'GET' }).catch(() => null);
  }

  return NextResponse.json({
    ok: anomalies.length === 0,
    date,
    deadmanActive,
    expected: expectedCount,
    posted: postedCount,
    anomalies,
    notified: anomalies.length > 0 ? notifySucceeded : undefined,
  });
}

async function safeNotify(subject: string, anomalies: string[]): Promise<boolean> {
  try {
    await notifyTaro({ subject, body: anomalies.join('\n') });
    return true;
  } catch (e) {
    console.error(`watchdog通知失敗: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
