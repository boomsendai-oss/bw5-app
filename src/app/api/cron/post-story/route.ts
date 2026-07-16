import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { todayJst, weekdayJst, nowUtcIso } from '@/lib/dateJst';
import { configured as igConfigured, publishStoryVideo, publishStoryImage, refreshTokenIfStale } from '@/lib/instagram';
import { pickNextQueueItem, markQueueItemPosted } from '@/lib/storyQueue';

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

const WEEKDAY_FILES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
  const fileName = `${WEEKDAY_FILES[weekday]}.mp4`;

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
  //   1. 日付指定オーバーライド {YYYY-MM-DD}.(mp4|jpg) (土日の変動・講師交代・特別な日用) を最優先
  //   2. 無ければ曜日デフォルト {曜日}.(mp4|jpg) (毎週固定ラインナップの日用)
  //   3. 無ければ承認済み「埋め草」キューから1本(レッスンが無い日用・TARO事前承認済みのみ)
  //   4. どれも無ければ投稿しない(間違った素材を出すより出さない方がマシ)
  // 同一優先度内では動画>画像。「まず静止画フライヤーを置き、動画が完成したら同名.mp4を
  // 置くだけで自動的に動画へ格上げ」という二段構えができる。
  const bases = [date, WEEKDAY_FILES[weekday]];
  const exts: Array<{ ext: string; type: 'video' | 'image' }> = [
    { ext: 'mp4', type: 'video' },
    { ext: 'jpg', type: 'image' },
  ];
  let picked: { url: string; type: 'video' | 'image'; base: string } | null = null;
  outer: for (const base of bases) {
    for (const { ext, type } of exts) {
      const url = `${origin}/stories/${base}.${ext}`;
      const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (head?.ok) {
        picked = { url, type, base };
        break outer;
      }
    }
  }

  if (picked) {
    // メンション(任意): 素材と同名の {base}.json に {"mentions":["ig_username",...]} を置くと
    // その公開アカウントをストーリーにタグ付けする(通知が飛び相手がリポスト可能)。無ければメンション無し。
    let mentions: string[] | undefined;
    const sidecar = await fetch(`${origin}/stories/${picked.base}.json`).catch(() => null);
    if (sidecar?.ok) {
      const j = await sidecar.json().catch(() => null);
      if (Array.isArray(j?.mentions)) mentions = j.mentions.filter((m: unknown) => typeof m === 'string');
    }

    try {
      await refreshTokenIfStale();
      const { mediaId } =
        picked.type === 'image'
          ? await publishStoryImage(picked.url, mentions)
          : await publishStoryVideo(picked.url, mentions);
      await logResult(date, weekday, picked.url, 'posted', mediaId);
      return NextResponse.json({ ok: true, posted: true, mediaId, mentions: mentions ?? [] });
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
      return NextResponse.json({ ok: true, posted: true, source: `queue#${item.id}`, mediaId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logResult(date, weekday, mediaUrl, 'error', undefined, msg);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // 4. ブレーキ: 出せる素材が何も無い
  const tried = bases.map((b) => `${b}.(mp4|jpg)`).join(' / ');
  await logResult(date, weekday, `${origin}/stories/{${bases.join('|')}}`, 'skipped_no_video');
  return NextResponse.json({
    ok: true,
    posted: false,
    note: `今日の素材(${tried})も承認済みキューも無いためスキップ`,
  });
}
