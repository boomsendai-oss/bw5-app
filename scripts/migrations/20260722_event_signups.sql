CREATE TABLE IF NOT EXISTS event_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  edit_token TEXT NOT NULL UNIQUE,
  understood INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_signups_event ON event_signups (event_id);

CREATE TABLE IF NOT EXISTS event_signup_performers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signup_id INTEGER NOT NULL,
  performer_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_signup_performers_signup ON event_signup_performers (signup_id);

CREATE TABLE IF NOT EXISTS event_signup_parts (
  performer_id INTEGER NOT NULL,
  part_key TEXT NOT NULL,
  PRIMARY KEY (performer_id, part_key)
);

CREATE TABLE IF NOT EXISTS event_signup_settings (
  event_id INTEGER PRIMARY KEY,
  parts_json TEXT NOT NULL DEFAULT '[]',
  fee_text TEXT NOT NULL DEFAULT '',
  deadline TEXT DEFAULT '',
  intro_md TEXT NOT NULL DEFAULT '',
  calendar_url TEXT DEFAULT '',
  is_open INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS event_signup_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  signup_id INTEGER,
  actor TEXT NOT NULL DEFAULT 'guest',
  action TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_signup_audit_event ON event_signup_audit (event_id);
