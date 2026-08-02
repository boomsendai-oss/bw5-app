-- ストーリー自動投稿の「その日だけの指示」(TARO 2026-08-03)
-- mode='skip' … その日は何も投稿しない(埋め草も出さない)
-- mode='pin'  … 通常の選択チェーンを無視して、指定した素材だけを投稿する
CREATE TABLE IF NOT EXISTS story_day_plan (
  date TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  media_path TEXT,
  media_type TEXT,
  note TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- アプリから上げた素材。Vercelは実行時にファイルを書けないのでDBに持ち、
-- 公開GET /api/story-media/{id} で配信する(Instagramが取りに来るため無認証)。
CREATE TABLE IF NOT EXISTS story_upload (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT,
  mime TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER,
  bytes BLOB NOT NULL,
  created_at TEXT
);
