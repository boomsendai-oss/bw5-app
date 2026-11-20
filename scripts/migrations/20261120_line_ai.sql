-- スタッフ用AI専用LINE公式アカウント「BOOM AI」（2026-11-20・システム部）
-- 受け口 /api/line-ai/webhook が書き、M5 の作業係（boom-events-hub/scripts/line_ai/worker.py）が読む。
CREATE TABLE IF NOT EXISTS line_ai_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS line_ai_groups (group_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'group', name TEXT, status TEXT NOT NULL DEFAULT 'pending', joined_at TEXT, updated_at TEXT, notified_at TEXT);
CREATE TABLE IF NOT EXISTS line_ai_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, group_id TEXT NOT NULL, user_id TEXT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL, started_at TEXT, done_at TEXT, result TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS idx_line_ai_jobs_status ON line_ai_jobs (status, id);
