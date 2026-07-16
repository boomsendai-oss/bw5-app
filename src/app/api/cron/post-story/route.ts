import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { todayJst, weekdayJst, nowUtcIso } from '@/lib/dateJst';
import { configured as igConfigured, publishStoryVideo, publishStoryImage, refreshTokenIfStale } from '@/lib/instagram';
import { pickNextQueueItem, markQueueItemPosted } from '@/lib/storyQueue';
import { WEEKDAY_FILES, findChainMediaList, loadSidecar, checkSchedule } from '@/lib/storyPlan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 日次ストーリー自動投稿 (毎朝 JST 8:00 に GitHub Actions cron から叩かれる)。
// 8時=全曜日レッスン前＋フォロワー朝の活動帯。「今日のレッスン」告知を朝に出す方針。
// 認証: Authorization: Bearer <CRON_SECRET> または x-cron-secret ヘッダ (gbp-reviewsと同パターン)
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

async function logResult(date: string, weekday: number, videoPath: string | null, status: string, igMediaId?: string, error?: string) {
  await execute(
    'INSERT INTO story_post_log (date, weekday, video_path, status, ig_media_id, error) VALUES (?, ?, ?, ?, ?, ?)',
    [date, weekday, videoPath, status, igMediaId ?? null, error ?? null]
  );
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = todayJst();
  const weekday = weekdayJst(date); // TZ安全(サーバーUTCでも1日ズレない)

  if (!igConfigured()) {
    // Meta App env未設定の間はno-opで成功扱い (cron自体は先に稼働させておく)
    await logResult(date, weekday, null, 'skipped_not_configured');
    return NextResponse.json({ ok: true, configured: false, note: 'Instagram連携env未設定のためスキップ' });
  }

  const origin = new URL(req.url).origin;

  // 素材の選択(作り置きをTAROが用意・Claudeは選んで出すだけ。無ければ出さない=ブレーキ):
  //   ①日付指定 → ②曜日デフォルト → ③承認済み埋め草キュー → ④出さない。
  // 1日複数本対応: {base}-2.jpg 等の連番があれば朝8:00に順番に連続投稿する(例: 土曜の朝の部+午後の部)。
  // 選択ロジック本体は storyPlan.ts (「明日の投稿予定」プレビューと共用)。
  const mediaList = await findChainMediaList(origin, date, weekday);

  if (mediaList.length > 0) {
    const results: Array<Record<string, unknown>> = [];
    let postedCount = 0;
    let errorCount = 0;

    try {
      await refreshTokenIfStale();
    } catch (e) {
      console.warn(`トークン更新失敗(投稿は続行): ${e instanceof Error ? e.message : e}`);
    }

    for (const media of mediaList) {
      // 冪等性: 同じ素材を同じ日に二度投稿しない(スロット単位。手動テストや二重発火対策)
      const already = await getOne(
        "SELECT 1 AS hit FROM story_post_log WHERE date = ? AND video_path = ? AND status = 'posted' LIMIT 1",
        [date, media.url]
      );
      if (already) {
        results.push({ media: media.base, skipped: '投稿済み(冪等)' });
        continue;
      }

      const sidecar = await loadSidecar(origin, media.base);

      // 正本スケジュール照合: 正本=BOOMのGoogleカレンダー(TAROが直接編集)。
      // 宣言レッスンがカレンダーに揃っていなければ(休講・代講・時間変更)このスロットは出さない。
      const check = await checkSchedule(date, sidecar.lessons);
      if (check.result === 'mismatch') {
        const detail = check.problems.join(' / ');
        await logResult(date, weekday, media.url, 'skipped_schedule_mismatch', undefined, detail);
        results.push({ media: media.base, skipped: `スケジュール不一致: ${detail}` });
        continue;
      }
      if (check.result === 'check-error') {
        // 正本が読めない時は投稿は止めない(止めると全停止事故になる)が、ログに残す
        console.warn(`スケジュール照合不可(投稿は続行): ${check.error}`);
      }

      const publish = (m?: string[]) =>
        media.type === 'image' ? publishStoryImage(media.url, m) : publishStoryVideo(media.url, m);

      try {
        let mediaId: string;
        let mentionsApplied = sidecar.mentions ?? [];
        try {
          ({ mediaId } = await publish(sidecar.mentions));
        } catch (e) {
          // メンション起因の失敗(非公開アカ・ユーザー名変更等)で投稿自体を落とさない:
          // メンション付きで失敗したらメンション無しで1回だけ再試行する。
          if (!sidecar.mentions?.length) throw e;
          console.warn(`メンション付き投稿に失敗→メンション無しで再試行: ${e instanceof Error ? e.message : e}`);
          ({ mediaId } = await publish(undefined));
          mentionsApplied = [];
        }
        await logResult(date, weekday, media.url, 'posted', mediaId);
        postedCount++;
        results.push({ media: media.base, posted: true, mediaId, mentions: mentionsApplied });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logResult(date, weekday, media.url, 'error', undefined, msg);
        errorCount++;
        results.push({ media: media.base, error: msg });
        // 1本失敗しても残りのスロットは投稿を試みる
      }
    }

    return NextResponse.json(
      { ok: errorCount === 0, posted: postedCount > 0, slots: mediaList.length, results },
      { status: errorCount === 0 ? 200 : 500 }
    );
  }

  // 通常素材が1本も無い日のみ埋め草へ。既に今日何か投稿済みなら重複させない(1日1本)。
  const alreadyToday = await getOne(
    "SELECT 1 AS hit FROM story_post_log WHERE date = ? AND status IN ('posted', 'posted_queue') LIMIT 1",
    [date]
  );
  if (alreadyToday) {
    return NextResponse.json({ ok: true, posted: false, note: `${date} は投稿済みのためスキップ(冪等)` });
  }

  // 3. 埋め草キュー(承認済みのみ・素材ファイルが実在しなければブレーキ)
  const item = await pickNextQueueItem(date);
  if (item) {
    const mediaUrl = `${origin}${item.media_path}`;
    const head = await fetch(mediaUrl, { method: 'HEAD' }).catch(() => null);
    if (!head?.ok) {
      await logResult(date, weekday, mediaUrl, 'error', undefined, `埋め草素材(queue#${item.id})のファイルが見つかりません`);
      return NextResponse.json({ ok: false, error: `queue#${item.id} の素材ファイルが未配置` }, { status: 500 });
    }
    try {
      await refreshTokenIfStale();
      const { mediaId } =
        item.media_type === 'image' ? await publishStoryImage(mediaUrl) : await publishStoryVideo(mediaUrl);
      await markQueueItemPosted(item, nowUtcIso());
      await logResult(date, weekday, mediaUrl, 'posted_queue', mediaId);
      return NextResponse.json({ ok: true, posted: true, source: `queue#${item.id}`, mediaId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logResult(date, weekday, mediaUrl, 'error', undefined, msg);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // 4. ブレーキ: 出せる素材が何も無い
  const tried = `${date}.(mp4|jpg) / ${WEEKDAY_FILES[weekday]}.(mp4|jpg)`;
  await logResult(date, weekday, `${origin}/stories/{${date}|${WEEKDAY_FILES[weekday]}}`, 'skipped_no_video');
  return NextResponse.json({
    ok: true,
    posted: false,
    note: `今日の素材(${tried})も承認済みキューも無いためスキップ`,
  });
}
