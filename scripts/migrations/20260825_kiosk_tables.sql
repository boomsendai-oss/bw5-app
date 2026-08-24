-- 無人物販kiosk (2026-08-25)
-- イベント会場のiPadセルフレジ。設計書: docs/superpowers/specs/2026-08-25-kiosk-design.md
-- 既存 merchandise/merch_orders/merch_variants はBW5(Square)用として凍結し流用しない。

CREATE TABLE IF NOT EXISTS kiosk_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kiosk_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_kiosk_products_sale ON kiosk_products (sale_id);

CREATE TABLE IF NOT EXISTS kiosk_product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_kiosk_variants_product ON kiosk_product_variants (product_id);

CREATE TABLE IF NOT EXISTS kiosk_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_total INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  amount_mismatch INTEGER NOT NULL DEFAULT 0,
  paid_after_expired INTEGER NOT NULL DEFAULT 0,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kiosk_orders_session ON kiosk_orders (stripe_session_id);

CREATE INDEX IF NOT EXISTS idx_kiosk_orders_status ON kiosk_orders (status);

CREATE TABLE IF NOT EXISTS kiosk_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  variant_id INTEGER,
  product_name TEXT NOT NULL,
  variant_label TEXT NOT NULL DEFAULT '',
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_kiosk_order_items_order ON kiosk_order_items (order_id);

CREATE TABLE IF NOT EXISTS kiosk_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  amount INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kiosk_payments_session ON kiosk_payments (stripe_session_id);
