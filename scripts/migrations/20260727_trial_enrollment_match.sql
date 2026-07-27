-- 集客計測基盤の整備 (WS AA / 2026-07-27)
--
-- ①体験→入会の自動突合の結果を保持する列を追加する。enrolled_after は既存だが、
--   「誰と突合したか」「何を根拠に突合したか」が残らず監査も解除もできないため補う。
-- ②来店判定は status 列を書き換えず集計時に行う。人が下した訂正だけを
--   attendance_override に永続化する (Lstep CSV の再取込で消えないようにするため)。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、列追加はこの台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、各 ALTER の ; は行末に置く(行内コメント禁止)。

ALTER TABLE trial_records ADD COLUMN enrolled_member_id INTEGER;

ALTER TABLE trial_records ADD COLUMN matched_by TEXT;

ALTER TABLE trial_records ADD COLUMN matched_at TEXT;

ALTER TABLE trial_records ADD COLUMN attendance_override TEXT;
