-- member_type カラム追加: 会員を regular/ticket/visitor/staff/college/休会 に分類
ALTER TABLE boom_members ADD COLUMN member_type TEXT DEFAULT 'regular';

-- 既存データを plan_name から自動分類
UPDATE boom_members SET member_type = 'ticket' WHERE plan_name LIKE '%チケット%';
UPDATE boom_members SET member_type = 'staff' WHERE plan_name LIKE '%管理者%' OR plan_name LIKE '%インストラクター%';
UPDATE boom_members SET member_type = '休会' WHERE plan_name LIKE '%休会%';
UPDATE boom_members SET member_type = 'college' WHERE plan_name LIKE '%カレッジ%';
-- レギュラー / 受け放題 / 60分 / 90分 → regular (デフォルトのまま)

CREATE INDEX IF NOT EXISTS idx_members_type ON boom_members(member_type);
