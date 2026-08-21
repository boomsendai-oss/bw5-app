import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import {
  buildXText,
  xWeightedLength,
  X_TEXT_MAX,
  buildXReplyCta,
  buildYouTubeMeta,
  buildThreadsText,
  buildFacebookDescription,
  buildTikTokTitle,
  sanitizeHandlesForOtherPlatform,
  THREADS_MENTIONABLE_HANDLES,
  pickNext,
  classifyByEnabled,
  findStalled,
  MAX_ATTEMPTS,
  CROSSPOST_PLATFORMS,
  type CrosspostRow,
} from '@/lib/crosspost';
import { notifyTaro } from '@/lib/notify';
import { configured as ytConfigured, uploadShort, trySetThumbnail } from '@/lib/youtube';
import { xConfigured, uploadVideo, postTweet, estimateChunkRequests } from '@/lib/xApi';
import { configured as threadsConfigured, postVideo as postThreadsVideo } from '@/lib/threads';
import { configured as fbConfigured, postReel as postFacebookReel } from '@/lib/facebookPage';
import { configured as tiktokConfigured, postVideo as postTikTokVideo } from '@/lib/tiktok';

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

type ReelRow = { id: number; title: string; video_path: string; caption: string; cover_path: string | null };

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
  // error も読む。打ち止め(findStalled)の理由をレスポンス/通知に載せるため
  const allRows = (await getAll(
    `SELECT id, reel_id, platform, status, attempts, error FROM reel_crossposts
     WHERE status IN ('pending', 'failed', 'skipped')`
  )) as CrosspostRow[];

  // TikTokだけは持ち主が違う。APIが審査却下(個人/社内利用はサポート外)になったため、
  // 2026-08-12から**Mac常駐(reel_pipeline.mjs)がブラウザで投稿**している。
  // ここでenv未設定として 'skipped' に上書きすると、常駐が書いた失敗理由が消え、
  // かつ 'skipped' は常駐の拾い対象なので延々と往復してしまう。**触らない**。
  const rows = allRows.filter((r) => r.platform !== 'tiktok');

  // 常駐が投稿に失敗した行は、このcron以外に誰も見ていない = 黙って埋もれる。
  // 気づけるように、諦めた行を1回だけTAROへ通知する(通知済みは error に印を付けて再送しない)。
  const NOTIFIED = '[通知済]';
  const tiktokFailed = allRows.filter(
    (r) => r.platform === 'tiktok' && r.status === 'failed' && !String(r.error ?? '').startsWith(NOTIFIED)
  );
  for (const r of tiktokFailed) {
    try {
      await notifyTaro({
        subjectPrefix: '[BOOM SNS]',
        subject: `TikTokへの投稿に失敗しました (reel #${r.reel_id})`,
        body: [
          `リール: reel_queue #${r.reel_id} (reel_crossposts #${r.id})`,
          `試行回数: ${r.attempts}`,
          '',
          `エラー: ${r.error ?? '(理由の記録なし)'}`,
          '',
          'TikTokはMac常駐がブラウザで投稿しています。ログイン切れかキャプチャの可能性があります。',
          '手動で出す場合: TikTok Studio のアップロード画面で動画とカバーを選ぶ(2クリック)。',
        ].join('\n'),
      });
      await execute(`UPDATE reel_crossposts SET error=? WHERE id=?`, [
        `${NOTIFIED} ${String(r.error ?? '').slice(0, 480)}`,
        r.id,
      ]);
    } catch (e) {
      console.warn(`TikTok失敗の通知に失敗: ${e instanceof Error ? e.message : e}`);
    }
  }

  const enabled = new Set<string>();
  if (ytConfigured()) enabled.add('youtube');
  if (xConfigured()) enabled.add('x');
  if (threadsConfigured()) enabled.add('threads');
  if (fbConfigured()) enabled.add('facebook');
  if (tiktokConfigured()) enabled.add('tiktok');
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

  // Xの無料枠は24時間で17リクエストしかなく、30MB級の動画1本で約11使う = 実質1日1本。
  // 配信先が増えて1日の実行回数を増やしても超過しないよう、直近24時間にXへ投稿できて
  // いたらこの回はXを対象から外す(YouTube/Threadsはそのまま進む)。
  const recentX = await getOne(
    `SELECT posted_at FROM reel_crossposts
     WHERE platform = 'x' AND status = 'posted' AND posted_at > ?
     ORDER BY posted_at DESC LIMIT 1`,
    [new Date(Date.now() - 24 * 3600 * 1000).toISOString()]
  );
  const pickable = recentX ? actionable.filter((r) => r.platform !== 'x') : actionable;

  // 打ち止め = 3回失敗して pickNext の候補から外れた行。**未配信のまま誰も再試行しない**。
  // これを黙って「対象なし」に混ぜると、cronは ok:true を返し続けて永久に緑になる。
  // ここでレスポンスに出し、ok:false にして必ず赤くする(findStalled のコメント参照)。
  // Xの24時間枠で外した行(pickable)ではなく actionable から数える —
  // 枠待ちは時間が経てば解決するが、打ち止めは人が手を入れるまで解決しないため。
  const stalled = findStalled(actionable);
  const stalledInfo = {
    stalled: stalled.length,
    stalledRows: stalled.map((r) => ({
      id: r.id,
      reelId: r.reel_id,
      platform: r.platform,
      attempts: r.attempts,
      error: r.error ?? null,
    })),
  };
  const stalledNote = `打ち止め${stalled.length}件(${stalled
    .map((r) => `#${r.id} reel${r.reel_id}/${r.platform}`)
    .join(', ')}) — ${MAX_ATTEMPTS}回失敗して自動再試行を諦めた行が未配信のまま残っています。手動対応が必要`;

  const target = pickNext(pickable);
  if (!target) {
    return NextResponse.json({
      // 「配信対象なし」と「打ち止めで諦めた」を混同しない。後者は未完了の仕事が残っている
      ok: stalled.length === 0,
      posted: false,
      added,
      skipped: toSkip.length,
      revived: toRevive.length,
      ...stalledInfo,
      note: stalled.length > 0
        ? stalledNote
        : toRevive.length > 0
        ? '復活した行を次回実行で処理します'
        : recentX && actionable.length > 0
          ? 'Xは24時間の無料枠待ち・他は配信対象なし'
          : '配信対象なし',
    });
  }

  // claim: 他プロセスが先に取っていたら諦める
  const claim = await execute(
    `UPDATE reel_crossposts SET status='posting', attempts = attempts + 1, updated_at=?
     WHERE id=? AND status IN ('pending','failed')`,
    [now, target.id]
  );
  if ((claim.rowsAffected ?? 0) === 0) {
    return NextResponse.json({
      ok: stalled.length === 0,
      posted: false,
      ...stalledInfo,
      note: `#${target.id} は別プロセスが処理中${stalled.length > 0 ? ` / ${stalledNote}` : ''}`,
    });
  }

  const fail = async (message: string) => {
    await execute(`UPDATE reel_crossposts SET status='failed', error=?, updated_at=? WHERE id=?`, [
      message.slice(0, 500),
      nowUtcIso(),
      target.id,
    ]);
    // claim で attempts は +1 済み。今回の失敗で使い切ったなら、この行は以後
    // pickNext の候補から外れる = 自動では二度と試されない。
    // 諦めた**その瞬間に1回だけ**TAROへ通知する(以後は毎回赤くなるcronが役目を引き継ぐ)。
    const attemptsNow = (target.attempts ?? 0) + 1;
    const justStalled = attemptsNow >= MAX_ATTEMPTS;
    if (justStalled) {
      try {
        await notifyTaro({
          subjectPrefix: '[BOOM SNS]',
          subject: `二次配信を諦めました (${target.platform} / reel #${target.reel_id})`,
          body: [
            `配信先: ${target.platform}`,
            `リール: reel_queue #${target.reel_id} (reel_crossposts #${target.id})`,
            `試行回数: ${attemptsNow}/${MAX_ATTEMPTS} — 自動再試行はここで止まります`,
            '',
            `エラー: ${message}`,
            '',
            '対応するまでこのリールはこの配信先へ出ません。',
            '原因を直したら reel_crossposts の当該行を status=\'pending\', attempts=0 に戻すと再開します。',
          ].join('\n'),
        });
      } catch (e) {
        // 通知が落ちてもcronのレスポンス(ok:false)は返す。検知経路を二重にしてあるのが要点
        console.warn('[crosspost] 打ち止め通知に失敗:', e);
      }
    }
    return NextResponse.json(
      {
        ok: false,
        platform: target.platform,
        error: message,
        justStalled,
        stalled: stalled.length + (justStalled ? 1 : 0),
        stalledRows: stalledInfo.stalledRows,
      },
      { status: 200 }
    );
  };

  try {
    const reel = (await getOne(
      `SELECT id, title, video_path, caption, cover_path FROM reel_queue WHERE id = ?`,
      [target.reel_id]
    )) as ReelRow | null;
    if (!reel) return await fail(`reel_queue #${target.reel_id} が見つかりません`);

    const origin = new URL(req.url).origin;
    const videoUrl = reel.video_path.startsWith('http')
      ? reel.video_path
      : `${origin}${reel.video_path}`;

    // 動画バイト列を取得(public配下のファイルを自分のoriginから取る)。
    // Threads と Facebook は**向こうがURLを取りに来る**方式なので、ここでは落とさない
    // (リールは1本50MB近くあり、要らないダウンロードは関数の時間とメモリを食うだけ)。
    const PULLS_URL = ['threads', 'facebook'];
    let bytes = new Uint8Array(0);
    if (!PULLS_URL.includes(target.platform)) {
      const vres = await fetch(videoUrl);
      if (!vres.ok) return await fail(`動画の取得に失敗 ${vres.status}: ${videoUrl}`);
      bytes = new Uint8Array(await vres.arrayBuffer());
      if (bytes.byteLength === 0) return await fail(`動画が空: ${videoUrl}`);
    }

    // キャプションはInstagram向けに書かれていて `@ハンドル` はInstagramのアカウント。
    // X / YouTube では @ が自分のところのアカウントを指すので、必ずここで無害化する
    // (詳細は sanitizeHandlesForOtherPlatform のコメント)。
    const instructors = (await getAll(
      'SELECT name, instagram_handle FROM instructors WHERE instagram_handle IS NOT NULL'
    )) as { name: string; instagram_handle: string }[];
    const nameByHandle = Object.fromEntries(
      instructors
        .filter((r) => r.instagram_handle)
        .map((r) => [String(r.instagram_handle).trim().toLowerCase(), String(r.name).trim()])
    );
    const safeCaption = sanitizeHandlesForOtherPlatform(reel.caption, nameByHandle);

    let externalId: string;
    let permalink: string;
    // 成功はしたが伝えておくべきこと(例: TikTokが審査未通過で全体公開にならなかった)。
    // 成功時は error をNULLに戻すので、ここに入れて一緒に書き込む
    let note: string | null = null;

    if (target.platform === 'youtube') {
      const meta = buildYouTubeMeta(reel.title, safeCaption);
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
      // カバー画像をサムネイルとして試行(Shortsは現状YouTube側制限で不可の想定・失敗しても投稿は成功のまま。
      // APIに開放された日からコード変更なしで効き始める)
      if (reel.cover_path) {
        try {
          const coverUrl = reel.cover_path.startsWith('http') ? reel.cover_path : `${origin}${reel.cover_path}`;
          const cres = await fetch(coverUrl);
          if (cres.ok) await trySetThumbnail(out.videoId, new Uint8Array(await cres.arrayBuffer()));
        } catch { /* サムネイルは任意・本体の成否に影響させない */ }
      }
    } else if (target.platform === 'threads') {
      // Threadsは本文にリンクを入れても表示が落ちないので、導線を本文に直接入れる。
      // ハンドルはInstagramと同一なので、Threads開設済みの講師だけ@メンションを残す
      // (本人に通知が飛び、リポストしてもらいやすくなる)
      const threadsCaption = sanitizeHandlesForOtherPlatform(
        reel.caption,
        nameByHandle,
        THREADS_MENTIONABLE_HANDLES
      );
      const out = await postThreadsVideo(videoUrl, buildThreadsText(threadsCaption));
      externalId = out.id;
      permalink = out.permalink;
    } else if (target.platform === 'facebook') {
      const out = await postFacebookReel(videoUrl, buildFacebookDescription(safeCaption));
      externalId = out.id;
      permalink = out.permalink;
    } else if (target.platform === 'tiktok') {
      // 審査が通るまでは privacy_level が SELF_ONLY に落ちる(tiktok.ts参照)。
      // どちらで出たかは error 欄に残して、画面から分かるようにする
      const out = await postTikTokVideo(bytes, buildTikTokTitle(safeCaption));
      externalId = out.publishId;
      permalink = out.permalink;
      if (out.privacyLevel !== 'PUBLIC_TO_EVERYONE') {
        note = `⚠️ 審査未通過のため「${out.privacyLevel}」で投稿されました(全体公開になっていません)`;
      }
    } else {
      // Xは無料枠が厳しいので、必要リクエスト数を先に見積もって明らかに無理なら諦める
      const needed = estimateChunkRequests(bytes.byteLength);
      if (needed > 17) {
        return await fail(`動画が大きすぎて無料枠に収まりません (推定${needed}リクエスト/上限17)`);
      }
      // 本文は動画を上げる**前**に検算する。Xは日本語を1文字=2で数えるので、
      // 超過したまま送ると「動画は上がったのにツイートだけ403」になり、
      // 無料枠だけ消えて何も残らない(2026-08-21に実際に起きた)。
      const xText = buildXText(safeCaption);
      const weight = xWeightedLength(xText);
      if (weight > X_TEXT_MAX) {
        return await fail(`本文がXの上限を超えています (X換算${weight}/${X_TEXT_MAX}文字)`);
      }
      const mediaId = await uploadVideo(bytes);
      const tweetId = await postTweet(xText, undefined, undefined, [mediaId]);
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
       SET status='posted', external_id=?, permalink=?, error=?, posted_at=?, updated_at=?
       WHERE id=?`,
      [externalId, permalink, note, nowUtcIso(), nowUtcIso(), target.id]
    );

    return NextResponse.json({
      // 今回の1件は成功しても、別に打ち止めの行が残っているなら全体としては正常ではない。
      // ここを ok:true にすると「毎回1件は成功するので永久に緑」という穴が残る
      ok: stalled.length === 0,
      posted: true,
      platform: target.platform,
      reelId: reel.id,
      permalink,
      added,
      ...stalledInfo,
      ...(stalled.length > 0 ? { note: stalledNote } : {}),
    });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}
