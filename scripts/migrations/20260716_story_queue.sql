-- インスタストーリーズ「埋め草」承認キュー (2026-07-16設計)
-- レッスン告知素材が無い日に、事前承認済みの素材から1本自動投稿する。
-- 設計: docs/decisions/2026-07-16_instagram-story-posting-time.md
--   - valid_until NULL = エバーグリーン(投稿後もapprovedのまま残りローテーション)
--   - valid_until あり = 期限付き(投稿後 posted / 期限切れ expired)
CREATE TABLE IF NOT EXISTS story_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_path TEXT NOT NULL,                 -- public配下のパス(例 /stories/queue/bw5-highlight1.mp4)
  media_type TEXT NOT NULL DEFAULT 'video', -- video / image
  kind TEXT NOT NULL,                       -- event / promo / highlight / progress
  title TEXT,                               -- 承認画面に出す説明(何の素材か)
  valid_from TEXT,                          -- 'YYYY-MM-DD'。NULL=いつでも可
  valid_until TEXT,                         -- 'YYYY-MM-DD'。NULL=エバーグリーン
  status TEXT NOT NULL DEFAULT 'pending',   -- pending / approved / posted / rejected / expired
  priority INTEGER DEFAULT 0,               -- 同条件内の優先度(大きいほど先)
  last_posted_at TEXT,
  times_posted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_story_queue_status ON story_queue(status);
