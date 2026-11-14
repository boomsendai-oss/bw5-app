-- 体験予約(trial_records)の重複判定に申込者名を追加する。
-- 背景: 従来の UNIQUE(lstep_id, reserved_at) では、1つのLINEアカウントから同じ枠へ
--       複数人(兄弟など)を予約すると2人目が1人目を潰して消えていた(2026-11-15 実害)。
-- 非破壊: 既存行は (lstep_id, reserved_at) で一意なので、applicant_name を足しても
--         一意性は保たれ、既存データは壊れない。消えていた2人目は取込をやり直すと入る。
-- 注: applicant_name が NULL の行(主に手動登録で lstep_id も NULL)は従来どおり重複判定の
--     対象外(SQLite は NULL 同士を等しくないと見なすため)。Lstepの体験CSVは申込者名が必ず入る。
DROP INDEX IF EXISTS uq_trial_lstep_reserved_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_lstep_reserved_name
  ON trial_records(lstep_id, reserved_at, applicant_name);
