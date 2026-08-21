-- 時間帯枠(story_day_slot)のストーリーにタグ付けするIGユーザー名。
-- ゲスト講師のワークショップ告知など「レッスン告知ではない枠」で本人をメンションするため。
-- 値はスペース区切りのユーザー名(@不要)。空/NULL = メンションなし。
ALTER TABLE story_day_slot ADD COLUMN mentions TEXT;
