CREATE TABLE IF NOT EXISTS tshirt_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edit_token TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  size TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  wants_shipping INTEGER NOT NULL DEFAULT 0,
  shipping_address TEXT NOT NULL DEFAULT '',
  shipping_phone TEXT NOT NULL DEFAULT '',
  unit_price INTEGER NOT NULL DEFAULT 0,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  handed_over INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tshirt_orders_created ON tshirt_orders (created_at);

CREATE TABLE IF NOT EXISTS tshirt_order_settings (
  id INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL DEFAULT '',
  unit_price INTEGER NOT NULL DEFAULT 3500,
  shipping_fee INTEGER NOT NULL DEFAULT 800,
  image_url TEXT NOT NULL DEFAULT '',
  open_at TEXT NOT NULL DEFAULT '',
  close_at TEXT NOT NULL DEFAULT '',
  is_open INTEGER NOT NULL DEFAULT 1,
  intro_md TEXT NOT NULL DEFAULT '',
  pickup_note TEXT NOT NULL DEFAULT '',
  thanks_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
