CREATE TABLE IF NOT EXISTS bf_draw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  division TEXT NOT NULL,
  phase TEXT NOT NULL,
  slot_no INTEGER NOT NULL,
  item_id INTEGER,
  drawn_at TEXT,
  UNIQUE(division, phase, slot_no)
);
CREATE INDEX IF NOT EXISTS idx_bf_draw_free ON bf_draw(division, phase, item_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bf_draw_item ON bf_draw(division, phase, item_id) WHERE item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bf_checkin (
  item_id INTEGER PRIMARY KEY,
  checked_in_at TEXT NOT NULL,
  staff_note TEXT
);

CREATE TABLE IF NOT EXISTS bf_match (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  division TEXT NOT NULL,
  round TEXT NOT NULL,
  match_no INTEGER NOT NULL,
  slot_a INTEGER,
  slot_b INTEGER,
  winner_slot INTEGER,
  updated_at TEXT,
  UNIQUE(division, round, match_no)
);
