-- HACOMONO RL005(固定枠:予約キャンセル処理一覧) の取込先。
--
-- 背景(2026-09-01): SHOKO WSの申込者を調べたとき、予約一覧(RL001)にも
-- レッスン別集計(RS002)にもキャンセル済みは載らないため、
-- 「予約が無い＝まだ申し込んでいない」と誤読した。実際は予約→キャンセルで、
-- チケット代¥2,000だけが宙に浮いていた。
-- 「予約が無い」には(a)未申込 (b)キャンセル済み の2通りがあり、
-- (b)を見ないと申込の実態も、払ったまま受講できていない人も分からない。
--
-- ⚠️ RL005の日付範囲は「キャンセル処理日」で効く(レッスン日ではない)。
--    未来のレッスンのキャンセルは、過去の処理日ぶんを見ないと出てこない。
-- PII最小化: メール・生年月日・住所は取り込まない(RL001と同方針)。

CREATE TABLE IF NOT EXISTS hacomono_cancellations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cancelled_at TEXT NOT NULL,
  lesson_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  program_code TEXT,
  program_name TEXT,
  staff_name TEXT,
  hacomono_member_id TEXT,
  kaiin_no TEXT,
  full_name TEXT,
  boom_member_id INTEGER,
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- RL005には予約IDが無いため、この4つ組を同一性の鍵にする
CREATE UNIQUE INDEX IF NOT EXISTS idx_hc_cancel_unique
  ON hacomono_cancellations (cancelled_at, hacomono_member_id, lesson_date, program_code);

CREATE INDEX IF NOT EXISTS idx_hc_cancel_lesson ON hacomono_cancellations (lesson_date);
CREATE INDEX IF NOT EXISTS idx_hc_cancel_member ON hacomono_cancellations (boom_member_id);
