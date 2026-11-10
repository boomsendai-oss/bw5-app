CREATE TABLE IF NOT EXISTS gbp_review_family (
  review_id TEXT PRIMARY KEY,
  family_key INTEGER,
  confidence TEXT NOT NULL,
  basis TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
