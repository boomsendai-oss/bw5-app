// インスタストーリーズ「埋め草」承認キュー。
// レッスン告知素材が無い日に、TARO承認済みの素材から1本選んで投稿する。
// 設計: docs/decisions/2026-07-16_instagram-story-posting-time.md
//   選択順: 期限付き(valid_untilあり)でwindow内のものを締切近い順
//         → 無ければエバーグリーンを last_posted_at が古い順にローテーション
//   キューが空なら投稿しない(ブレーキ)。承認は /staff/instagram で行う。

import { getOne, execute } from './db';

export type QueueItem = {
  id: number;
  media_path: string;
  media_type: 'video' | 'image';
  kind: string;
  title: string | null;
  valid_from: string | null;
  valid_until: string | null;
  status: string;
  priority: number;
  last_posted_at: string | null;
  times_posted: number;
};

/** 期限切れをexpiredへ落とし、今日出せる承認済み素材を1本選ぶ。無ければnull。 */
export async function pickNextQueueItem(date: string): Promise<QueueItem | null> {
  // 期限切れの掃除(pending/approvedどちらも)
  await execute(
    "UPDATE story_queue SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status IN ('pending','approved') AND valid_until IS NOT NULL AND valid_until < ?",
    [date]
  );
  return peekNextQueueItem(date);
}

/**
 * pickNextQueueItemの読み取り専用版(期限切れ掃除をしない)。
 * 「明日の投稿予定」プレビュー用 — 明日の日付で掃除すると今日まだ使える素材をexpiredにしてしまうため。
 */
export async function peekNextQueueItem(date: string): Promise<QueueItem | null> {
  const row = await getOne(
    `SELECT * FROM story_queue
     WHERE status = 'approved'
       AND (valid_from IS NULL OR valid_from <= ?)
       AND (valid_until IS NULL OR valid_until >= ?)
     ORDER BY
       (valid_until IS NULL) ASC,          -- 期限付きを先に
       COALESCE(last_posted_at, '') ASC,   -- 最も久しく出していないものから(繰り返しローテーション)
       valid_until ASC,                    -- 同条件なら締切が近い順
       priority DESC,
       id ASC
     LIMIT 1`,
    [date, date]
  );
  return (row as QueueItem | null) ?? null;
}

/**
 * 投稿成功後の状態更新。
 * 期限付き・エバーグリーンともapprovedのまま残してローテーションする(TARO 2026-07-26変更:
 * 募集告知など「期限まで空き日のたびに繰り返し出したい」素材のため。1回きりにしたい素材は
 * 投稿後に/staff/instagramで却下するか、valid_untilを翌日にして自然expireさせる)。
 * 期限切れは pickNextQueueItem が expired に落とす。
 */
export async function markQueueItemPosted(item: QueueItem, nowIso: string): Promise<void> {
  await execute(
    'UPDATE story_queue SET last_posted_at = ?, times_posted = times_posted + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [nowIso, item.id]
  );
}
