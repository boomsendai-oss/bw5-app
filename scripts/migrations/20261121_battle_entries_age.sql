-- BOOM DOJO: 生年月日の入力をやめ、「開催日の年齢」(数字)だけを聞く(TARO 2026-11-21「生年月日いらない。当日の年齢を記入してもらうだけでいい」)。
-- 破壊的変更はしない: birthdate 列は残す(新規は空文字)。それ以前の申込の年齢は表示時に birthdate から出す。
ALTER TABLE battle_entries ADD COLUMN age INTEGER;
