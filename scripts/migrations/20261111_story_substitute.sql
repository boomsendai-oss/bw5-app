-- 代講版のストーリー(TARO 2026-11-11: 代講はいつもの画像を代講の形に作り変えて自動で出す)
-- M1のスクリプト(boom-events-hub/scripts/story_substitute)が前夜に画像を作ってR2に置き、ここに登録する。
-- 投稿(post-story)は、その日の通常の素材(replaces_base)をこの画像に置き換え、lessons で当日朝にもう一度カレンダー照合する。
-- status は active(使う) / cancelled(使わない)。
CREATE TABLE IF NOT EXISTS story_substitute (
  date TEXT NOT NULL,
  replaces_base TEXT NOT NULL,
  media_url TEXT NOT NULL,
  lessons TEXT NOT NULL,
  swaps TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (date, replaces_base)
);
