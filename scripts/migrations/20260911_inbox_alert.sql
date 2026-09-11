-- 受信箱アラート(2026-09-11)。件名・差出人・本文は保存しない。
CREATE TABLE IF NOT EXISTS inbox_alert_state (
  account TEXT PRIMARY KEY,
  last_checked_ms INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  token_alert_date TEXT NOT NULL DEFAULT '',
  stall_alerted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inbox_alert_items (
  account TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  received_ms INTEGER NOT NULL,
  read_mode TEXT NOT NULL,
  tier TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  ai_failed INTEGER NOT NULL DEFAULT 0,
  in_inbox INTEGER NOT NULL DEFAULT 1,
  dry_run INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT,
  digested_at TEXT,
  resolved_at TEXT,
  resolved_reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account, message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_alert_items_open ON inbox_alert_items (tier, resolved_at, dry_run);
