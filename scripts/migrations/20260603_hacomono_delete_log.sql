-- HACOMONO で「枠を削除済み」を記録するログ。
-- アプリの removed/cancelled インスタンスは消しても残る(アプリ側の記録)ため、
-- HACOMONOで実際に削除した枠をここに記録し、削除プランから除外する(二重処理防止)。
CREATE TABLE IF NOT EXISTS hacomono_delete_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_date TEXT NOT NULL,        -- 'YYYY-MM-DD'
  start_time TEXT,                    -- 'HH:MM'
  class_name TEXT,
  pg_code TEXT,
  action TEXT NOT NULL DEFAULT 'deleted', -- deleted / skipped_reserved
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hacomono_delete_log_key
  ON hacomono_delete_log(instance_date, start_time, class_name);
