-- Lstep 表示名一括更新の実行ログ
-- いつ・どのアクションで・何件対象/変更したかを記録する (監査用)
--   action: 'generate_csv' (変換CSV生成) | 'upload_confirmed' (Lstepへアップロード反映確認)
CREATE TABLE IF NOT EXISTS lstep_update_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  target_rows INTEGER DEFAULT 0,
  updated_rows INTEGER DEFAULT 0,
  total_rows INTEGER DEFAULT 0,
  note TEXT,
  performed_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lstep_update_log_created ON lstep_update_log(created_at);
