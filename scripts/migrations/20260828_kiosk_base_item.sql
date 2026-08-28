-- kiosk商品にBASE取り込み元のitem_idを記録する (2026-08-28)
-- スタッフ画面の「BASEから取り込み」の重複防止と再取り込み(在庫更新)に使う。

ALTER TABLE kiosk_products ADD COLUMN base_item_id INTEGER;
