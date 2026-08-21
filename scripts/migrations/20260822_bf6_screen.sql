CREATE TABLE IF NOT EXISTS bf_screen_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'logo',
  division TEXT NOT NULL DEFAULT 'beginner',
  round TEXT,
  match_no INTEGER,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
INSERT INTO bf_screen_state (id, mode, division, rev, updated_at)
VALUES (1, 'logo', 'beginner', 0, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bf_photo (
  item_id INTEGER PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT
);
