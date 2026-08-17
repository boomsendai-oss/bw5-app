-- 会員Instagram: 本人/母/父の3枠に拡張 (2026-08-17 TARO指示)
--
-- フォームを「アカウント名1つ + 続柄を選ぶ」から「本人・母・父の3段を一度に入れる」へ変更する。
-- 子ども会員は本人と親の両方のアカウントがあることが多く、1つしか受け取れないと取りこぼす。
-- メンションに使う1つは 本人 > 母 > 父 の優先度でコード側(pickMentionHandle)が選ぶため、
-- DBには優先順位を持たせない。
--
-- instagram_owner_kind は「今どの枠をメンションに使っているか」を表す値として残す(表示用)。
--
-- 既存データの移し替え:
--   owner_kind='mother' で入っていた値は instagram_handle_mother へ移す(父も同様)。
--   instagram_handle は「本人」枠に意味を狭めるため、親の値が残らないようにする。
--   移動後は WHERE が二度と当たらないので再実行しても安全。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、列追加はこの台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、各文の ; は行末に置く(行内コメント禁止)。

ALTER TABLE boom_members ADD COLUMN instagram_handle_mother TEXT;

ALTER TABLE boom_members ADD COLUMN instagram_handle_father TEXT;

ALTER TABLE instagram_entries ADD COLUMN handle_self TEXT;

ALTER TABLE instagram_entries ADD COLUMN handle_mother TEXT;

ALTER TABLE instagram_entries ADD COLUMN handle_father TEXT;

UPDATE boom_members SET instagram_handle_mother = instagram_handle, instagram_handle = NULL WHERE instagram_owner_kind = 'mother' AND instagram_handle IS NOT NULL;

UPDATE boom_members SET instagram_handle_father = instagram_handle, instagram_handle = NULL WHERE instagram_owner_kind = 'father' AND instagram_handle IS NOT NULL;

UPDATE instagram_entries SET handle_self = handle WHERE owner_kind = 'self' AND handle_self IS NULL AND handle IS NOT NULL;

UPDATE instagram_entries SET handle_mother = handle WHERE owner_kind = 'mother' AND handle_mother IS NULL AND handle IS NOT NULL;

UPDATE instagram_entries SET handle_father = handle WHERE owner_kind = 'father' AND handle_father IS NULL AND handle IS NOT NULL;
