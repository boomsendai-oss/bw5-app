-- MOCCHINナンバーの支払い方法(TARO 2026-11-05: 全額一括／レッスン代を一括・2回・3回の4択)。
-- paid は1回目(参加費または全額)の入金。lesson_paid はレッスン代の分割の入金済み回(例 '1,2')。
-- reminded はお知らせメールを送った回(例 '0,1')。
ALTER TABLE mocchin_entries ADD COLUMN payment_plan TEXT NOT NULL DEFAULT 'lesson_once';
ALTER TABLE mocchin_entries ADD COLUMN lesson_paid TEXT NOT NULL DEFAULT '';
ALTER TABLE mocchin_entries ADD COLUMN reminded TEXT NOT NULL DEFAULT '';
