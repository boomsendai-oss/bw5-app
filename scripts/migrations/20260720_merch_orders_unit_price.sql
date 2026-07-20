-- グッズ売上を「当時の価格」で集計する (Fable改修設計 WS-E / P4 / 2026-07-20)
--
-- これまでKPIダッシュボードの物販売上は merchandise.price(=現在の価格)を
-- 注文時点までさかのぼって掛け直していたため、価格改定するだけで過去月の
-- 売上が書き換わっていた。注文作成時に当時の単価を merch_orders に固定保存し、
-- 集計は COALESCE(mo.unit_price, m.price) で読む。
--
-- 既存行のバックフィルはこの台帳では行わない。
-- BW5当時から価格改定があったかのTARO確認後に別マイグレーションで実施する
-- (それまでは unit_price IS NULL → 現在価格へフォールバック = 従来と同じ挙動)。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、列追加はこの台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、ALTER の ; は行末に置く(行内コメント禁止)。

ALTER TABLE merch_orders ADD COLUMN unit_price INTEGER;
