-- BOOMER'S FIGHT!!! vol.7 (2027-01-30) のお知らせリスト(ウェイトリスト)。
-- エントリー開始(2026-11-30予定)の前に、興味のある人のメールを集めておく。
-- ⚠️ BF6の bf_waitlist(満枠部門のキャンセル待ち)とは別物。こちらは「開始したら知らせる」名簿。
CREATE TABLE IF NOT EXISTS bf7_notify (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  divisions TEXT NOT NULL DEFAULT '[]',  -- 出たい部門(希望・確約ではない)
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(email)
);
CREATE INDEX IF NOT EXISTS idx_bf7_notify_created ON bf7_notify(created_at);
