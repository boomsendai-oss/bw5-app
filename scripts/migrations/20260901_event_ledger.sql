-- イベント収支台帳。アプリのDBに出てこない固定費とアプリ外の現金を記録する。
-- event_key で複数イベントを同居させる('bf6' など)。
CREATE TABLE IF NOT EXISTS event_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'income' | 'cost'
  category TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_amount INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL,         -- 合計額(qty*unit_amount と一致させるが、端数調整のため独立)
  collected INTEGER NOT NULL DEFAULT 0,  -- 入金:受取済 / 支出:支払済
  note TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_ledger_event ON event_ledger (event_key, kind, sort_order);
