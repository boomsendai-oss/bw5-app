-- 当日現金の集金記録(2026-09-10)。
-- 集金は人力なので、係の人が「誰から・いくら受け取ったか」をその場で残せるようにする。
-- お金は注文単位なので order_id を主キーにする(きょうだいで1注文なら1回払い)。
CREATE TABLE IF NOT EXISTS bf_cash_collect (
  order_id     INTEGER PRIMARY KEY,
  amount       INTEGER NOT NULL,          -- 実際に受け取った額(請求額と違ってもよい)
  collected_at TEXT NOT NULL,
  collected_by TEXT NOT NULL DEFAULT '',  -- 集金係の名前。誰が責任を持ったかの記録
  note         TEXT NOT NULL DEFAULT ''
);
