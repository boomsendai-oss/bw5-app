-- 体験予約 担当インストラクター周知の自動化(WS T / 2026-07-18)
--
-- trial-import が捨てていた「コース(体験/見学)・ダンス経験・きっかけ」を trial_records に保存し、
-- /staff/trials の周知メッセージに載せる。電話番号は周知に不要かつ個人情報最小化のため保存しない。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、列追加はこの台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、各 ALTER の ; は行末に置く(行内コメント禁止)。

-- CSV「コース」(体験レッスン/見学)
ALTER TABLE trial_records ADD COLUMN course_type TEXT;

-- CSV「ダンス経験」
ALTER TABLE trial_records ADD COLUMN dance_experience TEXT;

-- CSV「何でBOOMを知りましたか？」
ALTER TABLE trial_records ADD COLUMN referral_source TEXT;
