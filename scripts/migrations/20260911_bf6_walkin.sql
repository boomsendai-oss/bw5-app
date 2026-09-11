-- 当日券(予約なしで来たお客さん)の販売記録(2026-09-11)。
-- 入場受付の画面の中で、その場の現金で売って数える。申込(bf_orders)は作らない
-- (名前も連絡先も取らないため)。売上は収支ダッシュボードに足し込む。
CREATE TABLE IF NOT EXISTS bf_walkin_sale (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  adult      INTEGER NOT NULL DEFAULT 0,
  child      INTEGER NOT NULL DEFAULT 0,
  amount     INTEGER NOT NULL,            -- 受け取った額(サーバ側で料金設定から計算)
  sold_by    TEXT    NOT NULL DEFAULT '', -- 売ったスタッフの名前
  created_at TEXT    NOT NULL
);
