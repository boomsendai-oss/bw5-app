-- lesson_master に開始日/終了日を追加
-- 終了するレッスン(例: 向山ちびっこ 6/18ラスト)を、active=0 で全消しせず
-- 「この日以降は生成しない」「この日より前は生成しない」で管理できるようにする。
-- NULL = 無制限(従来通り)。
ALTER TABLE lesson_master ADD COLUMN start_date TEXT;  -- 'YYYY-MM-DD' この日以降のみ生成 (NULL=制限なし)
ALTER TABLE lesson_master ADD COLUMN end_date TEXT;    -- 'YYYY-MM-DD' この日まで生成、翌日以降は生成しない (NULL=制限なし)
