-- BOOM AI：グループに貼られた画像・ファイルの記録（2026-11-20）。中身は保存せず、M5 の作業係が必要なときに LINE から取る。
CREATE TABLE IF NOT EXISTS line_ai_files (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT UNIQUE NOT NULL, group_id TEXT NOT NULL, user_id TEXT, type TEXT NOT NULL, file_name TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_line_ai_files_group ON line_ai_files (group_id, id);
