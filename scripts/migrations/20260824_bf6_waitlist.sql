CREATE TABLE IF NOT EXISTS bf_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  division TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  buyer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  dancer_name TEXT NOT NULL,
  dancer_kana TEXT NOT NULL,
  performer_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  genre TEXT NOT NULL,
  rep TEXT NOT NULL,
  instagram TEXT,
  offered_at TEXT,
  offer_expires_at TEXT,
  resolved_at TEXT,
  order_id INTEGER,
  created_at TEXT,
  UNIQUE(division, position)
);
CREATE INDEX IF NOT EXISTS idx_bf_waitlist_div ON bf_waitlist(division, status, position);

ALTER TABLE bf_waitlist ADD COLUMN token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bf_waitlist_token ON bf_waitlist(token) WHERE token IS NOT NULL;
