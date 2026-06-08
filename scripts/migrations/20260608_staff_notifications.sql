CREATE TABLE IF NOT EXISTS staff_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,          -- 'new_member', 'lstep_linked', 'lstep_unlinked', 'plan_change', 'member_withdrew'
  title TEXT NOT NULL,
  detail TEXT,                 -- JSON string with extra info
  severity TEXT DEFAULT 'info', -- 'info', 'warning', 'error'
  related_member_id INTEGER,
  related_lstep_id TEXT,
  acknowledged_at TEXT,        -- NULL = unacknowledged
  acknowledged_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_notif_ack ON staff_notifications(acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_staff_notif_type ON staff_notifications(type);
CREATE INDEX IF NOT EXISTS idx_staff_notif_created ON staff_notifications(created_at);
