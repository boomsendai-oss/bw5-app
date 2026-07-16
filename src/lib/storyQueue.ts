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

  const row = await getOne(
    `SELECT * FROM story_queue
     WHERE status = 'approved'
       AND (valid_from IS NULL OR valid_from <= ?)
       AND (valid_until IS NULL OR valid_until >= ?)
     ORDER BY
       (valid_until IS NULL) ASC,          -- 期限付きを先に
       valid_until ASC,                    -- 締切が近い順
       priority DESC,
       COALESCE(last_posted_at, '') ASC,   -- エバーグリーンは最も出していないもの
       id ASC
     LIMIT 1`,
    [date, date]
  );
  return (row as QueueItem | null) ?? null;
}

/**
 * 投稿成功後の状態更新。
 * エバーグリーン(valid_until NULL)はapprovedのまま残してローテーション、期限付きはposted。
 */
export async function markQueueItemPosted(item: QueueItem, nowIso: string): Promise<void> {
  const nextStatus = item.valid_until === null ? 'approved' : 'posted';
  await execute(
    'UPDATE story_queue SET status = ?, last_posted_at = ?, times_posted = times_posted + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [nextStatus, nowIso, item.id]
  );
}
