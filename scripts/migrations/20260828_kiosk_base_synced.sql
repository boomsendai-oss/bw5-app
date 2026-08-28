-- kiosk注文のBASE在庫反映済みフラグ (2026-08-28)
-- イベント後の「売上をBASE在庫に反映」で二重減算を防ぐ。

ALTER TABLE kiosk_orders ADD COLUMN base_synced INTEGER NOT NULL DEFAULT 0;
