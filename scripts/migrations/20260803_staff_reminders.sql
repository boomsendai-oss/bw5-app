-- 日付リマインダー
-- 「N日後にこれをやる」をSTATE.mdやTAROの記憶に預けず、期日に通知が飛ぶようにする。
--
-- 既存の reel-decision-reminder は1件専用(日付ベタ書き・settingsにフラグ)だった。
-- 増えるたびにルートを足すのは無駄なので、行を追加するだけで済む形にする。

CREATE TABLE IF NOT EXISTS staff_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  due_date TEXT NOT NULL,          -- JST の YYYY-MM-DD。この日から送信対象
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sent_at TEXT,                    -- 送信済み時刻(UTC ISO)。入ったら二度と送らない
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- 同じ内容を二重登録しない(スクリプトの再実行への保険)
  UNIQUE(due_date, title)
);

CREATE INDEX IF NOT EXISTS idx_staff_reminders_due
  ON staff_reminders(sent_at, due_date);
