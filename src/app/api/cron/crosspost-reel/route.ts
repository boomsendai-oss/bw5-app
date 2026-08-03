import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import {
  buildXText,
  buildXReplyCta,
  buildYouTubeMeta,
  pickNext,
  classifyByEnabled,
  CROSSPOST_PLATFORMS,
  type CrosspostRow,
} from '@/lib/crosspost';
import { configured as ytConfigured, uploadShort } from '@/lib/youtube';
import { xConfigured, uploadVideo, postTweet, estimateChunkRequests } from '@/lib/xApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// リールの他SNS横展開 (YouTube Shorts / X)。
// Instagramへ公開済み(reel_queue.status='posted')のリールを、同じ動画ファイルから二次配信する。
//
// 設計の要点:
//  - **1回の実行で1件だけ**処理する。Xの無料枠が「24時間で17リクエスト」しかなく、
//    まとめて流すと即座に枯れるため(1本あたり約6リクエスト消費)。
//  - 配信先ごとに reel_crossposts の行を持ち、状態は独立して進む。
//    YouTubeが失敗してもXは進むし、その逆も同じ。
//  - claim (UPDATE ... WHERE status IN ('pending','failed')) で多重発火から保護。
//  - env未設定のプラットフォームは 'skipped' にして無駄な再試行を止める。
//    ただし env が入ったら pending へ戻す(投入順とenv設定順に依存させない)。
//
// 認証: post-reel / post-story と同じパターン。
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return req.headers.get('x-cron-secret') === secret;
}

type ReelRow = { id: number; title: string; video_path: string; caption: string };

/** Instagram公開済みのリールに対して、未登録の配信先行を作る(冪等: UNIQUE制約で重複しない) */
async function enqueueMissing(now: string): Promise<number> {
  const reels = (await getAll(
    `SELECT id FROM reel_queue WHERE status = 'posted' ORDER BY id DESC LIMIT 20`
  )) as { id: number }[];
  let added = 0;
  for (const r of reels) {
    for (const p of CROSSPOST_PLATFORMS) {
      const res = await execute(
        `INSERT OR IGNORE INTO reel_crossposts (reel_id, platform, status, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?)`,
        [r.id, p, now, now]
      );
      added += res.rowsAffected ?? 0;
    }
  }
  return added;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = nowUtcIso();
  const added = await enqueueMissing(now);

  // skipped も読む。envが後から入った時に pending へ戻すため(classifyByEnabled)
  const rows = (await getAll(
    `SELECT id, reel_id, platform, status, attempts FROM reel_crossposts
     WHERE status IN ('pending', 'failed', 'skipped')`
  )) as CrosspostRow[];

  const enabled = new Set<string>();
  if (ytConfigured()) enabled.add('youtube');
  if (xConfigured()) enabled.add('x');
  const { toSkip, toRevive, actionable } = classifyByEnabled(rows, enabled);

  // env未設定のプラットフォームは skipped にして無駄な再試行を止める
  for (const r of toSkip) {
    await execute(
      `UPDATE reel_crossposts SET status='skipped', error=?, updated_at=? WHERE id=?`,
      [`${r.platform} の連携envが未設定`, now, r.id]
    );
  }
  // envが入ったら pending へ戻す。attempts も 0 に戻す —
  // 止まっていた理由はリールの中身ではなく env なので、試行回数を持ち越さない
  for (const r of toRevive) {
    await execute(
      `UPDATE reel_crossposts SET status='pending', attempts=0, error=NULL, updated_at=? WHERE id=?`,
      [now, r.id]
    );
  }

  const target = pickNext(actionable);
  if (!target) {
    return NextResponse.json({
      ok: true,
      posted: false,
      added,
      skipped: toSkip.length,
      revived: toRevive.length,
      note: toRevive.length > 0 ? '復活した行を次回実行で処理します' : '配信対象なし',
    });
  }

  // claim: 他プロセスが先に取っていたら諦める
  const claim = await execute(
    `UPDATE reel_crossposts SET status='posting', attempts = attempts + 1, updated_at=?
     WHERE id=? AND status IN ('pending','failed')`,
    [now, target.id]
  );
  if ((claim.rowsAffected ?? 0) === 0) {
    return NextResponse.json({ ok: true, posted: false, note: `#${target.id} は別プロセスが処理中` });
  }

  const fail = async (message: string) => {
    await execute(`UPDATE reel_crossposts SET status='failed', error=?, updated_at=? WHERE id=?`, [
      message.slice(0, 500),
      nowUtcIso(),
      target.id,
    ]);
    return NextResponse.json({ ok: false, platform: target.platform, error: message }, { status: 200 });
  };

  try {
    const reel = (await getOne(
      `SELECT id, title, video_path, caption FROM reel_queue WHERE id = ?`,
      [target.reel_id]
    )) as ReelRow | null;
    if (!reel) return await fail(`reel_queue #${target.reel_id} が見つかりません`);

    // 動画バイト列を取得(public配下のファイルを自分のoriginから取る)
    const origin = new URL(req.url).origin;
    const videoUrl = reel.video_path.startsWith('http')
      ? reel.video_path
      : `${origin}${reel.video_path}`;
    const vres = await fetch(videoUrl);
    if (!vres.ok) return await fail(`動画の取得に失敗 ${vres.status}: ${videoUrl}`);
    const bytes = new Uint8Array(await vres.arrayBuffer());
    if (bytes.byteLength === 0) return await fail(`動画が空: ${videoUrl}`);

    let externalId: string;
    let permalink: string;

    if (target.platform === 'youtube') {
      const meta = buildYouTubeMeta(reel.title, reel.caption);
      const out = await uploadShort({
        bytes,
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        // 既定は限定公開。実物を1本確認してから 'public' に切り替える運用にする
        privacyStatus:
          (process.env.YOUTUBE_PRIVACY_STATUS as 'public' | 'unlisted' | 'private') ?? 'unlisted',
      });
      externalId = out.videoId;
      permalink = out.permalink;
    } else {
      // Xは無料枠が厳しいので、必要リクエスト数を先に見積もって明らかに無理なら諦める
      const needed = estimateChunkRequests(bytes.byteLength);
      if (needed > 17) {
        return await fail(`動画が大きすぎて無料枠に収まりません (推定${needed}リクエスト/上限17)`);
      }
      const mediaId = await uploadVideo(bytes);
      const tweetId = await postTweet(buildXText(reel.caption), undefined, undefined, [mediaId]);
      externalId = tweetId;
      permalink = `https://x.com/i/status/${tweetId}`;

      // 導線は本文ではなく**自分へのリプライ**に置く。
      // Xは外部リンク入りの投稿が伸びにくいので、本体はリンク無しで出し、
      // 直後のリプライでLINEへの導線を足す(本体の表示を犠牲にしない)。
      // ここが失敗しても動画本体は公開済みなので、全体を失敗にはしない。
      try {
        await postTweet(buildXReplyCta(), tweetId);
      } catch (e) {
        console.warn('[crosspost] Xの導線リプライに失敗(本体は投稿済み):', e);
      }
    }

    await execute(
      `UPDATE reel_crossposts
       SET status='posted', external_id=?, permalink=?, error=NULL, posted_at=?, updated_at=?
       WHERE id=?`,
      [externalId, permalink, nowUtcIso(), nowUtcIso(), target.id]
    );

    return NextResponse.json({
      ok: true,
      posted: true,
      platform: target.platform,
      reelId: reel.id,
      permalink,
      added,
    });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}
