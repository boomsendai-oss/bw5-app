CREATE TABLE IF NOT EXISTS referral_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trial_record_id INTEGER NOT NULL UNIQUE,
  referee_member_id INTEGER,
  referrer_member_id INTEGER,
  referrer_kana TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  ticket_expires_on TEXT,
  granted_at TEXT,
  notified_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);
