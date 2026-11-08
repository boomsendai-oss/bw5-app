-- 講師の本名のよみ(カタカナ)。TAROが全員分を確認済み(2026-11-08)。中身は本番のデータに直接入れる。
ALTER TABLE instructors ADD COLUMN real_name_kana TEXT;
