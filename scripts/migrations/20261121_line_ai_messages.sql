-- BOOM AI：グループの「最近の会話」（2026-11-21・システム部）。依頼のたびに作業係が読み、AIに材料として渡す。
-- 承認済みのグループの文字メッセージ（role=user）・BOOM AIへの依頼（request）・BOOM AIの返事（bot）を残す。
-- グループごとに直近48時間・最大50件。受け口が保存のたびに、作業係が見回りのたびに古いものを消す。
-- 電話番号・メールらしき文字は保存前に伏せる。display_name は作業係が LINE から取って埋める。
CREATE TABLE IF NOT EXISTS line_ai_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT UNIQUE, group_id TEXT NOT NULL, user_id TEXT, display_name TEXT, role TEXT NOT NULL DEFAULT 'user', text TEXT NOT NULL, quoted_message_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_line_ai_messages_group ON line_ai_messages (group_id, id);
CREATE INDEX IF NOT EXISTS idx_line_ai_messages_created ON line_ai_messages (created_at);
-- 依頼がどのメッセージか・何を引用して頼んだか（LINEのリプライ）
ALTER TABLE line_ai_jobs ADD COLUMN message_id TEXT;
ALTER TABLE line_ai_jobs ADD COLUMN quoted_message_id TEXT;
