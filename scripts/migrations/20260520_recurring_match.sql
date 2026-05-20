-- 変動する固定費に対応するため recurring_expenses を拡張
-- amount は「予算/目安額」として扱い、実額は銀行明細から自動確定する
ALTER TABLE recurring_expenses ADD COLUMN match_pattern TEXT;        -- 摘要部分一致パターン
ALTER TABLE recurring_expenses ADD COLUMN budget_amount INTEGER DEFAULT 0;  -- 予算額 (実額との差分表示用)
