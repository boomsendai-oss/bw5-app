CREATE TABLE IF NOT EXISTS bf_orders (
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

CREATE INDEX IF NOT EXISTS idx_bf_orders_session ON bf_orders (stripe_session_id);

CREATE INDEX IF NOT EXISTS idx_bf_orders_status ON bf_orders (payment_status);

CREATE TABLE IF NOT EXISTS bf_order_items (
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

CREATE INDEX IF NOT EXISTS idx_bf_order_items_order ON bf_order_items (order_id);

CREATE TABLE IF NOT EXISTS bf_payments (
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

CREATE INDEX IF NOT EXISTS idx_bf_payments_session ON bf_payments (stripe_session_id);

CREATE TABLE IF NOT EXISTS bf_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
