-- Lstep 表示名更新の「承認キュー」方式
-- Claude が Lstep フルエクスポートを取り込んで承認待ちバッチを作成 →
-- TARO がアプリで内容を見て承認 → Claude が承認分だけアップロード、という運用。
--
-- lstep_pending_batches: 1回の取り込み単位。元エクスポートCSVを保持(承認分のインポートCSV再生成用)。
--   status: open(承認受付中) | uploaded(反映済) | superseded(新バッチに置換) | discarded
CREATE TABLE IF NOT EXISTS lstep_pending_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  csv_text TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  target_rows INTEGER DEFAULT 0,
  changed_rows INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- lstep_pending_changes: バッチ内の行ごとの変更と承認状態。
--   status: pending(未判断) | approved(承認・反映待ち) | rejected(却下) | uploaded(反映済)
CREATE TABLE IF NOT EXISTS lstep_pending_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  lstep_id TEXT NOT NULL,
  role TEXT,
  member_label TEXT,
  current_display TEXT,
  new_display TEXT,
  status TEXT DEFAULT 'pending',
  decided_at TEXT,
  uploaded_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lpc_batch ON lstep_pending_changes(batch_id);
CREATE INDEX IF NOT EXISTS idx_lpc_status ON lstep_pending_changes(status);
CREATE INDEX IF NOT EXISTS idx_lpb_status ON lstep_pending_batches(status);
