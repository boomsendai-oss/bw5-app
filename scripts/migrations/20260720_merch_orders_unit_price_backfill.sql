-- 既存グッズ注文の unit_price バックフィル (Fable改修設計 WS-E / P4 / 2026-07-20)
--
-- 前提条件(設計書⑤-8)のTARO確認が取れたため実施する。
-- 確認内容(2026-07-20): 既存の有効な注文3件は全て BW5 当日(2026-05-02〜05-04)の
-- 会場販売で、シグネチャーTシャツ¥5,800 / <BM>フェルトロゴキャップ¥5,500 /
-- ミニトートバッグ¥2,000 = いずれも「当時の販売価格 = 現在の merchandise.price」。
-- つまり価格改定は無かったため、現在価格をそのまま当時価格として確定できる。
--
-- これを入れないと unit_price IS NULL のまま現在価格フォールバックが効き続けるため、
-- 今後セール価格を元に戻す等の価格変更をした瞬間に過去売上が書き換わってしまう。
--
-- 冪等: unit_price が既に入っている行(本デプロイ以降の新規注文)は対象外。
-- 巻き戻す場合は UPDATE merch_orders SET unit_price = NULL WHERE id IN (...)。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、この台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、; は行末に置く(行内コメント禁止)。

UPDATE merch_orders
SET unit_price = (SELECT m.price FROM merchandise m WHERE m.id = merch_orders.merch_id)
WHERE unit_price IS NULL
  AND EXISTS (SELECT 1 FROM merchandise m WHERE m.id = merch_orders.merch_id);
