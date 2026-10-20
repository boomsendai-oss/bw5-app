-- BOOMER'S FIGHT!!! vol.7 (2027-01-30) のエントリー＆チケット販売。
-- 列はvol.6(20260803_bf6_tables.sql の bf_*)と同じ。vol.6の記録と混ざらないよう別テーブルにする
-- (TARO 2026-10-20「システムはほぼ前回と同じなので流用して」)。
-- 既存テーブルは触らない(追加のみ)。
CREATE TABLE IF NOT EXISTS bf7_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  pay_method TEXT NOT NULL DEFAULT 'prepaid',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  amount_total INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT DEFAULT '',
  edit_token TEXT NOT NULL UNIQUE,
  expires_at TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bf7_orders_session ON bf7_orders (stripe_session_id);

CREATE INDEX IF NOT EXISTS idx_bf7_orders_status ON bf7_orders (payment_status);

CREATE TABLE IF NOT EXISTS bf7_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  performer_name TEXT DEFAULT '',
  dancer_name TEXT DEFAULT '',
  dancer_kana TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  genre TEXT DEFAULT '',
  rep TEXT DEFAULT '',
  instagram TEXT DEFAULT '',
  is_first_battle INTEGER NOT NULL DEFAULT 0,
  divisions TEXT NOT NULL DEFAULT '[]',
  qty INTEGER NOT NULL DEFAULT 1,
  unit_amount INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bf7_order_items_order ON bf7_order_items (order_id);

CREATE TABLE IF NOT EXISTS bf7_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_session_id TEXT DEFAULT '',
  payment_intent_id TEXT DEFAULT '',
  order_id INTEGER,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'jpy',
  payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bf7_payments_session ON bf7_payments (stripe_session_id);

CREATE TABLE IF NOT EXISTS bf7_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
