-- 観覧のお客さんの入場受付(2026-09-11)。
-- 開場時に名前で探して、リストバンドを渡した数を申込ごとに記録する。
-- 家族がばらばらに来ることがあるので、渡した/渡していないの2値ではなく枚数で持つ。
CREATE TABLE IF NOT EXISTS bf_gate_entry (
  order_id   INTEGER PRIMARY KEY,
  handed     INTEGER NOT NULL DEFAULT 0,   -- 渡したリストバンドの数
  handed_by  TEXT    NOT NULL DEFAULT '',  -- 最後に渡したスタッフの名前
  updated_at TEXT    NOT NULL DEFAULT ''
);
