-- Instagram DM(ダイレクトメッセージ)の受信台帳。
-- Instagram API with Instagram Login の messages Webhook で届いたDMを全件保存し、
-- 自動返信の有無・TAROの返信待ちを管理する(2026-10-07・唯愛HOUSE WSの外部申込から運用開始)。
-- 会員DBとは紐づけない(インスタのIDは会員番号と別世界)。
CREATE TABLE IF NOT EXISTS ig_dm_threads (
  sender_id TEXT PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  first_in_at TEXT NOT NULL,
  last_in_at TEXT NOT NULL,
  last_out_at TEXT,
  last_text TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT NOT NULL DEFAULT '',
  auto_reply_kinds TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ig_dm_threads_status ON ig_dm_threads(status, last_in_at);
CREATE TABLE IF NOT EXISTS ig_dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mid TEXT,
  sender_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  text TEXT,
  attachments TEXT NOT NULL DEFAULT '[]',
  kind TEXT,
  sent_by TEXT,
  ig_timestamp TEXT,
  created_at TEXT NOT NULL,
  raw TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ig_dm_messages_mid ON ig_dm_messages(mid);
CREATE INDEX IF NOT EXISTS idx_ig_dm_messages_sender ON ig_dm_messages(sender_id, id);
