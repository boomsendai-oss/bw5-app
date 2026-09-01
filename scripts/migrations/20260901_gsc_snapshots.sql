CREATE TABLE IF NOT EXISTS gsc_query_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measured_on TEXT NOT NULL,
  query TEXT NOT NULL,
  position REAL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  ctr REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(measured_on, query)
);

CREATE INDEX IF NOT EXISTS idx_gsc_query_measured ON gsc_query_snapshots (measured_on);

CREATE TABLE IF NOT EXISTS gsc_page_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measured_on TEXT NOT NULL,
  page TEXT NOT NULL,
  position REAL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  ctr REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(measured_on, page)
);

CREATE INDEX IF NOT EXISTS idx_gsc_page_measured ON gsc_page_snapshots (measured_on);
