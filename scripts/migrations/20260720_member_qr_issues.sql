-- 固定QR発行台帳(WS U / 2026-07-20)
-- QR画像・コード値・生メールアドレスは保存しない(email_to_maskedは伏せ字)
-- status: emailed / manual_needed / skipped_existing

CREATE TABLE IF NOT EXISTS member_qr_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hacomono_member_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  email_to_masked TEXT,
  issued_at TEXT,
  emailed_at TEXT,
  detail TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_member_qr_issues_status ON member_qr_issues(status);
