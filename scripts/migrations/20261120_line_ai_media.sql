-- BOOM AI：グループへ返す画像・ファイルの置き場（2026-11-20）。M5 の作業係が書き、/api/line-ai/media/<token>/<name> で配る。
CREATE TABLE IF NOT EXISTS line_ai_media (token TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL);
