CREATE TABLE IF NOT EXISTS tshirt_order_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  action TEXT NOT NULL,
  snapshot_before TEXT NOT NULL DEFAULT '',
  snapshot_after TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tshirt_order_audit_order ON tshirt_order_audit (order_id)
