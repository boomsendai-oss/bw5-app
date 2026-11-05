-- MOCCHINナンバーのカード決済(TARO 2026-11-05: 銀行振込とカードを選べる・手数料はBOOM負担)。
-- pay_token は本人専用の支払いページのURLに使う。card_steps はカードで入金された回(例 '0,1')。
-- checkout_session_id / checkout_step は作成済みの決済画面(同じ回を二重に作らないため)。
ALTER TABLE mocchin_entries ADD COLUMN pay_method TEXT NOT NULL DEFAULT 'transfer';
ALTER TABLE mocchin_entries ADD COLUMN pay_token TEXT NOT NULL DEFAULT '';
ALTER TABLE mocchin_entries ADD COLUMN card_steps TEXT NOT NULL DEFAULT '';
ALTER TABLE mocchin_entries ADD COLUMN checkout_session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE mocchin_entries ADD COLUMN checkout_step INTEGER NOT NULL DEFAULT -1;
CREATE TABLE IF NOT EXISTS mocchin_payments (
  stripe_event_id   TEXT PRIMARY KEY,
  event_type        TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  entry_id          INTEGER,
  step              INTEGER,
  amount            INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);
