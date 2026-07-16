import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { todayJst, weekdayJst, nowUtcIso } from '@/lib/dateJst';
import { configured as igConfigured, publishStoryVideo, publishStoryImage, refreshTokenIfStale } from '@/lib/instagram';
import { pickNextQueueItem, markQueueItemPosted } from '@/lib/storyQueue';
import { WEEKDAY_FILES, findChainMedia, loadSidecar, checkSchedule } from '@/lib/storyPlan';

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

  // 冪等性: 同じ日に既に投稿済みなら再投稿しない。
  // (手動テストと定時cronの重複、GH Actionsのリトライ、二重発火から二重ストーリーを防ぐ)
  const already = await getOne(
    "SELECT 1 AS hit FROM story_post_log WHERE date = ? AND status = 'posted' LIMIT 1",
    [date]
  );
  if (already) {
    return NextResponse.json({ ok: true, posted: false, note: `${date} は投稿済みのためスキップ(冪等)` });
  }

  const origin = new URL(req.url).origin;

  // 素材の選択(作り置きをTAROが用意・Claudeは選んで出すだけ。無ければ出さない=ブレーキ):
  //   ①日付指定 → ②曜日デフォルト → ③承認済み埋め草キュー → ④出さない。
  // 選択ロジック本体は storyPlan.ts (「明日の投稿予定」プレビューと共用)。
  const picked = await findChainMedia(origin, date, weekday);

  // 正本スケジュール照合: 素材がlessons宣言を持つ場合、今日の実スケジュール
  // (lesson_master+lesson_instances=Gカレンダーの生成元)と一致するか確認する。
  // 休講・代講で食い違う日は間違った告知を出さず、埋め草キューへフォールバック(2026-07-16 TARO決定)。
  const sidecar = picked ? await loadSidecar(origin, picked.base) : {};
  let scheduleMismatch: string | null = null;
  if (picked) {
    const check = await checkSchedule(date, sidecar.lessons);
    if (check.result === 'mismatch') {
      scheduleMismatch = `素材の宣言[${check.declared.join(', ')}] ≠ 今日の正本[${check.actual.join(', ')}]`;
      await logResult(date, weekday, picked.url, 'skipped_schedule_mismatch', undefined, scheduleMismatch);
    }
  }

  if (picked && !scheduleMismatch) {
    const mentions = sidecar.mentions;

    const publish = (m?: string[]) =>
      picked.type === 'image' ? publishStoryImage(picked.url, m) : publishStoryVideo(picked.url, m);

    try {
      await refreshTokenIfStale();
      let mediaId: string;
      let mentionsApplied = mentions ?? [];
      try {
        ({ mediaId } = await publish(mentions));
      } catch (e) {
        // メンション起因の失敗(非公開アカ・ユーザー名変更等)で投稿自体を落とさない:
        // メンション付きで失敗したらメンション無しで1回だけ再試行する。
        if (!mentions?.length) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`メンション付き投稿に失敗→メンション無しで再試行: ${msg}`);
        ({ mediaId } = await publish(undefined));
        mentionsApplied = [];
      }
      await logResult(date, weekday, picked.url, 'posted', mediaId);
      return NextResponse.json({ ok: true, posted: true, mediaId, mentions: mentionsApplied });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logResult(date, weekday, picked.url, 'error', undefined, msg);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
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
      return NextResponse.json({
        ok: true,
        posted: true,
        source: `queue#${item.id}`,
        mediaId,
        ...(scheduleMismatch ? { note: `スケジュール不一致のため埋め草に切替: ${scheduleMismatch}` } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logResult(date, weekday, mediaUrl, 'error', undefined, msg);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // 4. ブレーキ: 出せる素材が何も無い
  if (scheduleMismatch) {
    // 不一致ログは記録済み。埋め草も無かったので今日は何も出さない。
    return NextResponse.json({
      ok: true,
      posted: false,
      note: `スケジュール不一致で通常素材をスキップ・埋め草も無いため投稿なし (${scheduleMismatch})`,
    });
  }
  const tried = `${date}.(mp4|jpg) / ${WEEKDAY_FILES[weekday]}.(mp4|jpg)`;
  await logResult(date, weekday, `${origin}/stories/{${date}|${WEEKDAY_FILES[weekday]}}`, 'skipped_no_video');
  return NextResponse.json({
    ok: true,
    posted: false,
    note: `今日の素材(${tried})も承認済みキューも無いためスキップ`,
  });
}
