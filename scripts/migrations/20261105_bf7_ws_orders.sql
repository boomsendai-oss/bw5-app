-- BF7 HIRO ワークショップ(2027-01-31)の申込。1人1行(2026-11-05・TARO)。
-- 定員は各クラス25名。class_first / class_second が 1 のクラスの枠を使う。
-- pay_method は prepaid(カード)/ transfer(銀行振込)。当日払いはなし(TARO 2026-11-05)。
-- payment_status は pending(カード決済待ち・30分の仮押さえ)/ transfer_due(振込待ち)/ paid / expired / canceled。
-- member_check は会員確認の結果: none(非会員の申告)/ confirmed(会員と確認)/ review(スタッフ確認待ち)/ rejected(会員でないと判断)。
-- is_test=1 はスタッフの確認用テスト。定員と集計に数えない。
CREATE TABLE IF NOT EXISTS bf7_ws_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  edit_token        TEXT    NOT NULL UNIQUE,
  name              TEXT    NOT NULL,
  kana              TEXT    NOT NULL,
  age               TEXT    NOT NULL,
  guardian_name     TEXT    NOT NULL DEFAULT '',
  phone             TEXT    NOT NULL,
  email             TEXT    NOT NULL,
  is_member         INTEGER NOT NULL DEFAULT 0,
  member_check      TEXT    NOT NULL DEFAULT 'none',
  matched_member_id INTEGER,
  candidate_ids     TEXT    NOT NULL DEFAULT '[]',
  class_first       INTEGER NOT NULL DEFAULT 0,
  class_second      INTEGER NOT NULL DEFAULT 0,
  amount_total      INTEGER NOT NULL,
  pay_method        TEXT    NOT NULL,
  payment_status    TEXT    NOT NULL,
  stripe_session_id TEXT    NOT NULL DEFAULT '',
  expires_at        TEXT    NOT NULL DEFAULT '',
  applied_on        TEXT    NOT NULL DEFAULT '',
  note              TEXT    NOT NULL DEFAULT '',
  staff_note        TEXT    NOT NULL DEFAULT '',
  is_test           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bf7_ws_orders_status ON bf7_ws_orders (payment_status, id);

-- Stripeの通知の記録(同じ通知が二重に届いても1回だけ処理する)
CREATE TABLE IF NOT EXISTS bf7_ws_payments (
  stripe_event_id TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  order_id        INTEGER,
  amount          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
