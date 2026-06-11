-- T-178: GBPクチコミ自動返信システム (承認キュー方式)
-- 1日4回cronで新着クチコミを取込→Claudeでドラフト生成→スタッフ承認→GBP APIで返信投稿

CREATE TABLE IF NOT EXISTS gbp_reviews (
  review_id TEXT PRIMARY KEY,        -- GBPのreviewId
  reviewer_name TEXT,
  star_rating INTEGER,               -- 1〜5
  comment TEXT,                      -- クチコミ本文 (本文なし星だけの場合はNULL)
  create_time TEXT,
  update_time TEXT,
  reply_comment TEXT,                -- 投稿済み返信
  reply_time TEXT,
  status TEXT DEFAULT 'new',         -- new / draft_ready / posted / skipped
  draft TEXT,                        -- Claude生成ドラフト (スタッフ編集可)
  drafted_at TEXT,
  posted_at TEXT,
  raw_json TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gbp_reviews_status ON gbp_reviews(status);
