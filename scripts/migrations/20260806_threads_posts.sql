-- Threadsテキスト投稿キュー (SNSテキスト配信レーン 2026-08-06設計)
-- x_posts(X承認キュー)の姉妹テーブル。
-- x_post_id でリンクされた行はXの承認に追従する(承認操作は/staff/x-postsの1回だけ)。
-- 追従判定は src/lib/threadsPosts.ts resolveLinkedAction / 実行は cron threads-autopost。
-- status: draft / approved / posting / posted / failed / rejected (x_postsと同じ状態機械)
CREATE TABLE IF NOT EXISTS threads_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x_post_id INTEGER,
  text TEXT NOT NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  posted_thread_id TEXT,
  permalink TEXT,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_threads_posts_status_scheduled ON threads_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_threads_posts_x_post ON threads_posts(x_post_id);
