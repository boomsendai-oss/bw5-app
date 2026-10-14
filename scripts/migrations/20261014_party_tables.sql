-- パーティー申込(クリスマスパーティー2026〜)。BF6(bf_*)とは別建て(2026-10-14)。
-- event_key でイベントを分ける(今年は 'xmas2026')。来年は設定行を足すだけで使い回す。
-- 設計書: docs/superpowers/specs/2026-10-14-xmas-party-design.md
CREATE TABLE IF NOT EXISTS party_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key         TEXT    NOT NULL,
  kind              TEXT    NOT NULL,             -- 'ticket'(参加申込) / 'entry'(出演エントリー)
  buyer_name        TEXT    NOT NULL,
  buyer_kana        TEXT    NOT NULL DEFAULT '',  -- 名簿を50音順に並べるため
  email             TEXT    NOT NULL,
  phone             TEXT    NOT NULL DEFAULT '',
  is_member         INTEGER,                      -- 1=会員 0=会員以外 NULL=聞いていない(エントリー)
  people_count      INTEGER NOT NULL DEFAULT 0,   -- 小学生以上(参加申込)
  infant_count      INTEGER NOT NULL DEFAULT 0,   -- 未就学児(無料)
  team_name         TEXT    NOT NULL DEFAULT '',
  genre             TEXT    NOT NULL DEFAULT '',
  member_count      INTEGER NOT NULL DEFAULT 0,   -- 出演メンバー数(エントリー)
  pay_method        TEXT    NOT NULL,             -- 'card' / 'cash'
  status            TEXT    NOT NULL,             -- pending/paid/cash_due/expired/canceled/refunded
  unit_price        INTEGER NOT NULL DEFAULT 0,   -- 申込時の1人あたり単価(後で設定を変えてもずれない)
  amount_total      INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT    NOT NULL DEFAULT '',
  edit_token        TEXT    NOT NULL UNIQUE,
  expires_at        TEXT    NOT NULL DEFAULT '',
  audio_url         TEXT    NOT NULL DEFAULT '',
  audio_filename    TEXT    NOT NULL DEFAULT '',
  audio_uploaded_at TEXT    NOT NULL DEFAULT '',
  staff_note        TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_party_orders_event ON party_orders (event_key, kind, status);
CREATE INDEX IF NOT EXISTS idx_party_orders_session ON party_orders (stripe_session_id);

CREATE TABLE IF NOT EXISTS party_entry_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_party_entry_members_order ON party_entry_members (order_id);

-- Stripe Webhook の受信記録。stripe_event_id UNIQUE で同じイベントの二重適用を防ぐ
CREATE TABLE IF NOT EXISTS party_payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id   TEXT    NOT NULL UNIQUE,
  event_type        TEXT    NOT NULL,
  stripe_session_id TEXT    NOT NULL DEFAULT '',
  payment_intent_id TEXT    NOT NULL DEFAULT '',
  order_id          INTEGER,
  amount            INTEGER NOT NULL DEFAULT 0,
  payload           TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL
);

-- 公開日時・締切・料金・上限など。本番中にデプロイせずDBの値で切り替えるため
CREATE TABLE IF NOT EXISTS party_settings (
  event_key  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_key, key)
);
