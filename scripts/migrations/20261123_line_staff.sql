-- スタジオとのやりとり用のLINE公式アカウント「BOOMスタッフアカウント」（@183qsgtk・2026-11-23・システム部）。
-- 受け口 /api/line-staff/webhook が書き、M5 の作業係（boom-events-hub/scripts/line_staff/staff.py）が読む。
-- 受け口はスタジオへ何も返さない。送るのは作業係が、TAROのOKが出た文を承認済みのグループへ送るときだけ。
CREATE TABLE IF NOT EXISTS line_staff_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS line_staff_groups (group_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'group', name TEXT, studio TEXT, status TEXT NOT NULL DEFAULT 'pending', joined_at TEXT, updated_at TEXT, notified_at TEXT);
-- 承認済みのグループの文字メッセージ（role=user）と、作業係が送った文（bot）。グループごとに直近90日・最大2000件。
CREATE TABLE IF NOT EXISTS line_staff_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT UNIQUE, group_id TEXT NOT NULL, user_id TEXT, role TEXT NOT NULL DEFAULT 'user', text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_line_staff_messages_group ON line_staff_messages (group_id, id);
