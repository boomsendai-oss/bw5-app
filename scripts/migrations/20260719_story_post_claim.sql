CREATE TABLE IF NOT EXISTS story_post_claim (date TEXT NOT NULL, video_path TEXT NOT NULL, created_at TEXT, UNIQUE(date, video_path));
