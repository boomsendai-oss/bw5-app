-- T-175: HACOMONO RL001(固定枠:予約一覧) の受講履歴テーブル。
-- 会員ごとの最終受講日を確定し、チケット会員の休眠判定に使う。
-- PII最小化のためメールアドレス・生年月日・住所系カラムは取り込まない。

CREATE TABLE IF NOT EXISTS hacomono_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER UNIQUE,        -- 予約ID (HACOMONO一意)
  status TEXT,                          -- チェックイン / 無断キャンセル
  booked_at TEXT,                       -- 予約処理日
  lesson_date TEXT,                     -- 受講日 (YYYY-MM-DD)
  start_time TEXT,
  end_time TEXT,
  program_code TEXT,
  program_name TEXT,
  staff_name TEXT,
  hacomono_member_id TEXT,
  kaiin_no TEXT,
  full_name TEXT,
  boom_member_id INTEGER,               -- boom_members.id (取込時に突合)
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resv_member_date ON hacomono_reservations(hacomono_member_id, lesson_date);
CREATE INDEX IF NOT EXISTS idx_resv_date ON hacomono_reservations(lesson_date);
