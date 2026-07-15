-- インスタストーリーズ日次自動投稿の履歴テーブル
-- weekday = 0(日)〜6(土)。1日1投稿想定なので (date) を実質的なユニークキーとして運用する。
CREATE TABLE IF NOT EXISTS story_post_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  video_path TEXT,
  status TEXT NOT NULL, -- posted / skipped_no_video / error
  ig_media_id TEXT,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_story_post_log_date ON story_post_log(date);
