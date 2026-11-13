-- クチコミ声がけ: TAROが「この家族には送らない」と決めた家族を恒久的に候補から外す(2026-11-13)
ALTER TABLE review_outreach ADD COLUMN excluded_at TEXT;
-- 外した理由(個人名は書かない)
ALTER TABLE review_outreach ADD COLUMN excluded_reason TEXT;
