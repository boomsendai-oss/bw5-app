-- リール投稿キュー (2026-07-17設計)
-- 発表会リール等を予定日時つきで積み、GH Actions cron(毎日19:00 JST)がサーバー側で自動公開する。
-- TAROは /staff/instagram で「いつ・どれが出るか」を確認・キャンセルできる。
-- 設計メモ: ~/BOOM/SNS戦略/発表会リール制作フロー_v1.md
CREATE TABLE IF NOT EXISTS reel_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,                       -- 表示名(例: BW5 HOUSE EXPERT)
  video_path TEXT NOT NULL,                  -- public配下(例 /reels/2026-07-17_house_expert.mp4)
  cover_path TEXT,                           -- カバー画像(例 /reels/..._cover.jpg)。NULL可
  caption TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,                -- UTC ISO。cronがこの時刻以降に公開
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled / posting / posted / failed / canceled
  ig_media_id TEXT,
  permalink TEXT,
  error TEXT,
  posted_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reel_queue_status ON reel_queue(status);
