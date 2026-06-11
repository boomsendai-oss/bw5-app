-- T-155 follow-up: hacomono_billing_records の重複排除キーを「売上ID」に変更する。
-- 旧UNIQUE(billing_date, member_id, product_name, amount)は、同一会員が同日に
-- 同一商品・同額を複数回購入した取引(例: 高橋真桜さん 6/9 追加受講チケット×2)を
-- 1件に潰してしまい売上が過小計上になっていた。
-- 売上ID(HACOMONO取引一意ID)をUNIQUEキーにして取引単位で正確に保持する。
--
-- SQLiteはCREATE TABLE由来のUNIQUE制約を直接DROPできないためテーブルを作り直す。

CREATE TABLE hacomono_billing_records_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT UNIQUE,
  billing_date TEXT,
  member_id TEXT,
  kaiin_no TEXT,
  product_name TEXT,
  product_category TEXT,
  amount INTEGER,
  payment_method TEXT,
  status TEXT,
  boom_member_id INTEGER,
  imported_at TEXT
);

INSERT INTO hacomono_billing_records_new
  (id, billing_date, member_id, kaiin_no, product_name, product_category, amount, payment_method, status, boom_member_id, imported_at)
SELECT
  id, billing_date, member_id, kaiin_no, product_name, product_category, amount, payment_method, status, boom_member_id, imported_at
FROM hacomono_billing_records;

DROP TABLE hacomono_billing_records;
ALTER TABLE hacomono_billing_records_new RENAME TO hacomono_billing_records;

CREATE INDEX idx_billing_category ON hacomono_billing_records(product_category);
CREATE INDEX idx_billing_date ON hacomono_billing_records(billing_date);
