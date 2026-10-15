-- BW6プレ告知LP(boom-sendai.com/bw6)の「出てみたい／ちょっと気になる」ボタンの記録(2026-10-15)。
-- 1端末1行(device_id=端末のlocalStorageに置くランダムID)。押し直しは同じ行を更新してまとめる。
-- name/class_label/age_group は押した後の任意入力(申込ではない)。空のままの行が大半になる想定。
CREATE TABLE IF NOT EXISTS bw6_interest (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    TEXT    NOT NULL UNIQUE,
  kind         TEXT    NOT NULL,
  first_kind   TEXT    NOT NULL,
  src          TEXT    NOT NULL DEFAULT 'direct',
  press_count  INTEGER NOT NULL DEFAULT 1,
  name         TEXT    NOT NULL DEFAULT '',
  class_label  TEXT    NOT NULL DEFAULT '',
  age_group    TEXT    NOT NULL DEFAULT '',
  user_agent   TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bw6_interest_kind ON bw6_interest (kind, src);
