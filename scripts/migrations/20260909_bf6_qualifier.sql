-- BF6 予選通過者(2026-09-09)
--
-- 小中・一般は予選で8名に絞ってからベスト8のくじ(くじ引き②)を引く。
-- くじ引き②の一覧に部門の全員(25名など)を出すと押し間違いが起きるため、
-- 先にスタッフが通過者をチェックし、くじ引き②・写真撮影はその8名だけに絞る(TARO 2026-09-09)。
-- 通過者の記録としても残す。

CREATE TABLE IF NOT EXISTS bf_qualifier (
  division   TEXT    NOT NULL,
  item_id    INTEGER NOT NULL,
  created_at TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (division, item_id)
);
