-- T-165: daily_sync の実行結果を記録し、失敗の握り潰しを解消する。
-- 失敗時は staff_notifications にも書き込まれ、insightsに鮮度バッジを出す。

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL,                -- ok / error
  message TEXT,                        -- 成功サマリー or エラー内容
  lstep_state_age_days INTEGER         -- Lstep storageStateの経過日数 (20日超で再生成警告)
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_ran_at ON sync_runs(ran_at);
