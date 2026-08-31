CREATE TABLE IF NOT EXISTS survey_client_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT,
  stack TEXT,
  user_agent TEXT,
  url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
