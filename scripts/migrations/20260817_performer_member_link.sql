-- 出演者(performers) と 会員(boom_members) を繋ぐ (2026-08-17)
--
-- 目的: 「演目/イベントに出た人 → 会員 → Instagramハンドル」を辿れるようにして、
--       SNS発信時のメンション候補を自動で出せるようにする。
--       これまでは氏名の文字列一致に頼っており、異体字(髙/高・澤/沢)で取り違えが起きていた。
--
-- is_external: 会員でないことが確認済みの出演者に立てる印。
--   スクール外部からの参加者(諏訪GALS!!・Mini Wave・Little Wave)、
--   特別ナンバー GRAFFITI の外部ゲスト、講師、TAROの家族 が該当する(TARO確認済み 2026-08-17)。
--   これを立てておかないと、毎回「会員DBに一致しない人」として調査対象に浮上してしまう。
--
-- ハンドルの正本は boom_members.instagram_handle へ移す。
-- ただし performers 側の列は残す — **非会員の出演者にもメンション対象が居る**ため
-- (会員でない人は boom_members に置き場が無い)。会員分は移行後に NULL にする。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、列追加はこの台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、各文の ; は行末に置く(行内コメント禁止)。

ALTER TABLE performers ADD COLUMN member_id INTEGER;

ALTER TABLE performers ADD COLUMN is_external INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_performers_member ON performers (member_id);
