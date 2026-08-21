-- BF6 一斉メールの送信ログ(2026-08-21)
-- 目的: 二重送信の防止と、誰にいつ送ったかの記録。
-- 34名程度への送信でも、二重に届くと信用を落とすため必ずここに残す。
CREATE TABLE IF NOT EXISTS bf_broadcast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,        -- 送信の識別子(例: call-time-1)。同じkeyは二度送れない
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS bf_broadcast_recipient (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL,            -- sent / failed
  error TEXT,
  created_at TEXT,
  UNIQUE(broadcast_id, email)
);
