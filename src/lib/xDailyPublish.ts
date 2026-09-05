// 「本日のレッスン」投稿を生成した場で投稿するためのヘルパー (2026-09-05)
//
// 背景: GitHub Actionsの定期実行がこのリポで大きく遅れる(生成cron=12:00 JST予定が16〜18時、
// 投稿cron=15分毎の予定が3〜5時間毎)。生成→別cronで投稿、の二段構えだと2時間の猶予に間に合わず
// 9/2〜9/4の3日連続で未投稿になった。生成した時点で投稿してしまえば投稿cronに依存しない。
import { execute, getAll, getOne } from './db';
import { deleteTweet, postTweet, xConfigured } from './xApi';
import { buildTweetPayloads, parsePartsJson, parseTweetIdsJson } from './xPosts';
import { configured as threadsConfigured, connectionStatus, deletePost, postText } from './threads';

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

export type RetractResult = { xDeleted: number; threadsDeleted: number; errors: string[] };

/**
 * 当日分の投稿を撤回する: 投稿済みツイート/Threads投稿を削除し、行を rejected にする。
 * その後に x-daily-schedule を再実行すると同日ガードに引っかからず作り直せる(=出し直し)。
 * 削除に失敗しても行は rejected にする(手で消せるように error に残す)。
 */
export async function retractDailyPost(xPostId: number): Promise<RetractResult> {
  const out: RetractResult = { xDeleted: 0, threadsDeleted: 0, errors: [] };
  const row = await getOne('SELECT status, posted_tweet_ids FROM x_posts WHERE id = ?', [xPostId]);
  if (!row) { out.errors.push(`x_posts id=${xPostId} が無い`); return out; }
  if (row.status === 'posted' && xConfigured()) {
    for (const id of parseTweetIdsJson((row.posted_tweet_ids as string | null) ?? null)) {
      try { await deleteTweet(id); out.xDeleted++; } catch (e) { out.errors.push(e instanceof Error ? e.message : String(e)); }
    }
  }
  await execute(
    "UPDATE x_posts SET status = 'rejected', error = ?, updated_at = datetime('now') WHERE id = ?",
    [`出し直しのため撤回(${new Date().toISOString()})${out.errors.length ? ' / 削除エラー: ' + out.errors.join('; ').slice(0, 300) : ''}`, xPostId]
  );
  const links = await getAll('SELECT id, status, posted_thread_id FROM threads_posts WHERE x_post_id = ?', [xPostId]);
  for (const t of links) {
    if (t.status === 'posted' && t.posted_thread_id && threadsConfigured()) {
      try { await deletePost(String(t.posted_thread_id)); out.threadsDeleted++; } catch (e) { out.errors.push(e instanceof Error ? e.message : String(e)); }
    }
    await execute("UPDATE threads_posts SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", [t.id]);
  }
  return out;
}
