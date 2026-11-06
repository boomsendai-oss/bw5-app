-- BF7 HIRO ワークショップの銀行振込を Stripe の銀行振込(顧客ごとの振込先口座・自動消し込み)に切り替える(2026-11-06・TARO)。
-- stripe_payment_intent_id: 振込を待つ Stripe の PaymentIntent。入金が済むと payment_intent.succeeded が届く。
-- bank_account_json: お客さんに案内した振込先(銀行名・支店・種別・口座番号・名義)。空なら固定の口座(BF7_WS_BANK)を案内した申込。
ALTER TABLE bf7_ws_orders ADD COLUMN stripe_payment_intent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE bf7_ws_orders ADD COLUMN bank_account_json TEXT NOT NULL DEFAULT '';
