// 「本日のレッスン」投稿を生成した場で投稿するためのヘルパー (2026-09-05)
//
// 背景: GitHub Actionsの定期実行がこのリポで大きく遅れる(生成cron=12:00 JST予定が16〜18時、
// 投稿cron=15分毎の予定が3〜5時間毎)。生成→別cronで投稿、の二段構えだと2時間の猶予に間に合わず
// 9/2〜9/4の3日連続で未投稿になった。生成した時点で投稿してしまえば投稿cronに依存しない。
import { execute, getOne } from './db';
import { postTweet, xConfigured } from './xApi';
import { buildTweetPayloads, parsePartsJson } from './xPosts';
import { configured as threadsConfigured, connectionStatus, postText } from './threads';

export type PublishDecision = 'schedule' | 'post-now' | 'too-late';

/**
 * 生成時刻(JST)で、いま投稿するか/12:30に予約するか/見送るかを決める(純関数)。
 * - 10:30より前: 予約(12:30)に任せる(cronが早く発火することは実測上ほぼ無い)
 * - 10:30〜20:30: その場で投稿(昼〜夕方なら「本日のレッスン」として意味がある)
 * - 20:30より後: 見送り(夜にその日の予定を流しても遅い)
 */
export function decideImmediatePublish(hourJst: number, minuteJst: number): PublishDecision {
  const t = hourJst * 60 + minuteJst;
  if (t < 10 * 60 + 30) return 'schedule';
  if (t > 20 * 60 + 30) return 'too-late';
  return 'post-now';
}

export type PublishResult = { ok: true; tweetIds: string[] } | { ok: false; reason: string };

/** approved の x_posts を今すぐ投稿する(x-autopost と同じ claim → post → posted の手順) */
export async function publishXPostNow(postId: number): Promise<PublishResult> {
  if (!xConfigured()) return { ok: false, reason: 'X API env未設定' };
  const claim = await execute(
    "UPDATE x_posts SET status = 'posting', updated_at = datetime('now') WHERE id = ? AND status = 'approved'",
    [postId]
  );
  if (Number(claim.rowsAffected) === 0) return { ok: false, reason: '対象がapprovedではない(他プロセスが処理中か)' };
  const row = await getOne('SELECT parts FROM x_posts WHERE id = ?', [postId]);
  const parts = parsePartsJson((row?.parts as string | null) ?? null);
  const postedIds: string[] = [];
  try {
    if (parts.length === 0) throw new Error('partsが空');
    const payloads = buildTweetPayloads(parts, []);
    for (let i = 0; i < payloads.length; i++) {
      const id = await postTweet(payloads[i].text, i > 0 ? postedIds[i - 1] : undefined);
      postedIds.push(id);
    }
    await execute(
      "UPDATE x_posts SET status = 'posted', posted_tweet_ids = ?, error = NULL, updated_at = datetime('now') WHERE id = ?",
      [JSON.stringify(postedIds), postId]
    );
    return { ok: true, tweetIds: postedIds };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await execute(
      "UPDATE x_posts SET status = 'failed', posted_tweet_ids = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
      [postedIds.length ? JSON.stringify(postedIds) : null, msg, postId]
    );
    return { ok: false, reason: msg };
  }
}

/** リンク済みの threads_posts(draft/approved) を今すぐ投稿する。Threads未設定なら何もしない */
export async function publishThreadsPostNow(threadsId: number): Promise<PublishResult | { ok: false; reason: string; skipped: true }> {
  if (!threadsConfigured()) return { ok: false, reason: 'Threads env未設定', skipped: true };
  const conn = await connectionStatus();
  if (!conn.threadsConnected) return { ok: false, reason: 'Threads未連携', skipped: true };
  const claim = await execute(
    "UPDATE threads_posts SET status = 'posting', updated_at = datetime('now') WHERE id = ? AND status IN ('draft','approved')",
    [threadsId]
  );
  if (Number(claim.rowsAffected) === 0) return { ok: false, reason: '対象がdraft/approvedではない' };
  const row = await getOne('SELECT text FROM threads_posts WHERE id = ?', [threadsId]);
  try {
    const { id, permalink } = await postText(String(row?.text ?? ''));
    await execute(
      "UPDATE threads_posts SET status = 'posted', posted_thread_id = ?, permalink = ?, error = NULL, updated_at = datetime('now') WHERE id = ?",
      [id, permalink, threadsId]
    );
    return { ok: true, tweetIds: [id] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await execute(
      "UPDATE threads_posts SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?",
      [msg, threadsId]
    );
    return { ok: false, reason: msg };
  }
}
