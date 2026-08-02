-- リールの他SNS横展開 (YouTube Shorts / X)
-- Instagramへ公開済みのリールを、同じ動画ファイルから各プラットフォームへ二次配信する。
--
-- 設計: reel_queue に列を足すのではなく別テーブルにする。
--   - 1本のリール × N個の配信先 で、状態(成功/失敗/リトライ)が独立して進むため
--   - 配信先が増えても reel_queue のスキーマを触らずに済む
--   - Instagram本体の投稿状態(reel_queue.status)と混ざらない

CREATE TABLE IF NOT EXISTS reel_crossposts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reel_id INTEGER NOT NULL,               -- reel_queue.id
  platform TEXT NOT NULL,                 -- 'youtube' | 'x'
  status TEXT NOT NULL DEFAULT 'pending', -- pending / posting / posted / failed / skipped
  external_id TEXT,                       -- YouTube videoId / X tweet id
  permalink TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  posted_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- 同じリールを同じ配信先へ二重登録しない(cronの多重発火・再実行への保険)
  UNIQUE(reel_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_reel_crossposts_status
  ON reel_crossposts(status, reel_id);
