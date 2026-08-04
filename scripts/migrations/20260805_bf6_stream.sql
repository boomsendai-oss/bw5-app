CREATE TABLE IF NOT EXISTS bf_stream_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  stream_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bf_stream_keys_order ON bf_stream_keys (order_id);

CREATE TABLE IF NOT EXISTS bf_stream_sessions (
  key_id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);
