-- 口コミ返信の自動公開 (2026-11-14 TARO決定・試し運用)。自動で公開した日時。朝のまとめの一覧に使う
ALTER TABLE gbp_reviews ADD COLUMN auto_posted_at TEXT;
