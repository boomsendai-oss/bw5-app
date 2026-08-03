-- 1日に複数回、時間を分けてストーリーを予約する(TARO 2026-08-03)
-- 例: 08:00 発表会リール告知 / 12:30 バトル練習会 / 21:00 体験レッスン
-- 行が1つでも入っている日は「その日は手動指定」とみなし、自動選択も埋め草も出さない。
CREATE TABLE IF NOT EXISTS story_day_slot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  slot_time TEXT NOT NULL,   -- 'HH:MM' JST
  media_path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  note TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_story_day_slot ON story_day_slot(date, slot_time);
