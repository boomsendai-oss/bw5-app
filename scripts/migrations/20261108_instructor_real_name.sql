-- 講師の本名(漢字)。活動名(name)とは別。MOCCHIN申込などで講師を本名で確かめるため(TARO 2026-11-08)。
-- 中身は個人情報なのでリポジトリに書かず、本番のデータに直接入れる。
ALTER TABLE instructors ADD COLUMN real_name TEXT;
