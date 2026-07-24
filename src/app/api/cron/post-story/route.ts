import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne, getAll } from '@/lib/db';
import { todayJst, weekdayJst, nowUtcIso } from '@/lib/dateJst';
import { configured as igConfigured, publishStoryVideo, publishStoryImage, refreshTokenIfStale } from '@/lib/instagram';
import { pickNextQueueItem, markQueueItemPosted } from '@/lib/storyQueue';
import { WEEKDAY_FILES, findChainMediaList, loadSidecar, checkSchedule, resolveMentions } from '@/lib/storyPlan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 正準ベースURL。cron/watchdog/デプロイ固有URLでoriginが変わると、素材URLが変わって
// 冪等ガード・claimロックがすり抜け二重投稿する事故があった(2026-07-22)。素材URLは常にこの
// 安定エイリアスから作り、重複判定はorigin非依存の pathname で行う。
const SITE_ORIGIN = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://bw5-app.vercel.app';
// URLからoriginを剥がしたパス(= スロットの安定ID)。重複判定はこれで行う。
function slotKey(u: string): string {
  try { return new URL(u).pathname; } catch { return u; }
}

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

async function logResult(
  date: string,
  weekday: number,
  videoPath: string | null,
  status: string,
  igMediaId?: string,
  error?: string,
  mentions?: { requested: string[]; applied: string[]; failed: string[] }
) {
  const res = await execute(
    'INSERT INTO story_post_log (date, weekday, video_path, status, ig_media_id, error) VALUES (?, ?, ?, ?, ?, ?)',
    [date, weekday, videoPath, status, igMediaId ?? null, error ?? null]
  );
  if (mentions) {
    // mentions_* 列は防御的に別UPDATEで書く(migration未適用でも本体INSERTは落とさない)
    try {
      await execute(
        'UPDATE story_post_log SET mentions_requested = ?, mentions_applied = ?, mentions_failed = ? WHERE rowid = ?',
        [
          JSON.stringify(mentions.requested),
          JSON.stringify(mentions.applied),
          JSON.stringify(mentions.failed),
          res.lastInsertRowid ?? null,
        ]
      );
    } catch {
      // 列未適用(migration前)なら無視
    }
  }
}

// 二重投稿防止のスロットロック。GH cron(最大3本)とwatchdogの自己修復loopbackが
// 同時に走っても、あるスロットを実際に publish するのは最初に claim できた1プロセスだけ。
// UNIQUE(date, video_path) の INSERT が通れば所有権獲得、衝突(rowsAffected=0)なら他が処理中。
// publish 失敗時は releaseClaim で解放し、次回の再投稿を可能にする。
async function claimSlot(date: string, videoPath: string): Promise<boolean> {
  try {
    const res = await execute(
      'INSERT INTO story_post_claim (date, video_path, created_at) VALUES (?, ?, ?) ON CONFLICT(date, video_path) DO NOTHING',
      [date, videoPath, nowUtcIso()]
    );
    return (res.rowsAffected ?? 0) > 0;
  } catch {
    // claim表が未適用(migration前)なら可用性優先でロック無し投稿を続行する
    return true;
  }
}

async function releaseClaim(date: string, videoPath: string): Promise<void> {
  try {
    await execute('DELETE FROM story_post_claim WHERE date = ? AND video_path = ?', [date, videoPath]);
  } catch {
    // 解放失敗は次回の冪等ガード('posted'照合)で吸収されるため致命ではない
  }
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

  const origin = SITE_ORIGIN; // 常に安定した本番エイリアスから素材URLを作る(origin差による二重投稿を防ぐ)

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
      // 冪等性: 同じ素材を同じ日に二度投稿しない(スロット単位。手動テストや二重発火対策)。
      // 判定は origin非依存の pathname で行う(過去にorigin差で二重投稿した事故の恒久対策)。
      const key = slotKey(media.url);
      const postedToday = await getAll(
        "SELECT video_path FROM story_post_log WHERE date = ? AND status = 'posted'",
        [date]
      );
      if (postedToday.some((r) => slotKey(String(r.video_path)) === key)) {
        results.push({ media: media.base, skipped: '投稿済み(冪等)' });
        continue;
      }

      // library-auto は台帳(manifest)由来の宣言/メンションをmediaが直接持つ(sidecar {base}.json は無い)
      const sidecar = media.source === 'library-auto'
        ? { lessons: media.lessons, mentions: media.mentions }
        : await loadSidecar(origin, media.base);

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

      // メンションは登録簿(instructors.instagram_handle)からの解決を優先し、
      // sidecar.mentions は後方互換のフォールバックにする(json.mentions手管理の陳腐化を排除)。
      // このスロットはcheckSchedule通過済み=宣言講師はカレンダーと一致しているので、
      // 宣言講師名からハンドルを引けば代講(KOKEKO等)も正しく解決される。
      let requestedMentions: string[] = sidecar.mentions ?? [];
      if (sidecar.lessons && sidecar.lessons.length > 0) {
        try {
          const { handles } = await resolveMentions(sidecar.lessons.map((l) => l.instructor));
          if (handles.length > 0) requestedMentions = handles;
        } catch (e) {
          console.warn(`メンション解決失敗(sidecar.mentionsにフォールバック): ${e instanceof Error ? e.message : e}`);
        }
      }

      // このスロットの投稿権を獲得(取れなければ他プロセスが処理中=スキップ)。キーはorigin非依存のpathname。
      const claimed = await claimSlot(date, key);
      if (!claimed) {
        results.push({ media: media.base, skipped: '別プロセスが投稿処理中(claim)' });
        continue;
      }

      try {
        // publishStory側が「載せられる最大の部分集合」を自動で選び、落ちたハンドルはmentionsFailedで返す
        const { mediaId, mentionsApplied, mentionsFailed } =
          media.type === 'image'
            ? await publishStoryImage(media.url, requestedMentions)
            : await publishStoryVideo(media.url, requestedMentions);
        await logResult(date, weekday, media.url, 'posted', mediaId, undefined, {
          requested: requestedMentions,
          applied: mentionsApplied,
          failed: mentionsFailed,
        });
        postedCount++;
        results.push({ media: media.base, posted: true, mediaId, mentions: mentionsApplied, mentionsFailed });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // publish失敗: claimを解放して次回の再投稿を可能にする
        await releaseClaim(date, key);
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
