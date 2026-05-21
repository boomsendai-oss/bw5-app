-- 体験予約 (Lstepカレンダー) 取込のための整合性確保
-- (lstep_id, reserved_at) で重複防止する UNIQUE インデックス
-- 注: lstep_id が NULL の場合、SQLite では NULL 同士は等しくないため
-- 重複には引っかからない。NULL は手動登録時のみの想定なので許容する。
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_lstep_reserved_at
  ON trial_records(lstep_id, reserved_at);
