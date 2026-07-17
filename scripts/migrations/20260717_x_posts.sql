-- X(Twitter)投稿承認キュー (2026-07-17設計)
-- Claudeが生成した投稿下書きをキューに積み、TAROがスマホで月2回まとめて承認、
-- 予約時刻が来たらcron(/api/cron/x-autopost)がX API v2で自動ポストする。
-- GBPクチコミ返信(自動取込→AI下書き→承認→投稿)と同じ思想。
--   - parts: JSON配列。ツリー投稿は複数要素・単発は1要素(各要素=ツイート本文)
--   - scheduled_at: UTC ISO8601(Z付き・dateJst.tsの記録規約)。NULL=予約なし(手動トリガー待ち=cron対象外)
--   - status: draft(承認待ち) / approved(予約中) / posting(cron処理中・二重投稿ガード)
--             / posted / failed / rejected。失敗の自動リトライはしない(差し戻し→再承認で再試行)
CREATE TABLE IF NOT EXISTS x_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL DEFAULT 'boom',
  parts TEXT NOT NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  posted_tweet_ids TEXT,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_x_posts_status_scheduled ON x_posts(status, scheduled_at);
