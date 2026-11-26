-- 特設ワークショップ(/ws/[slug])の申込。1回ごとに sp_ws_events の1行(slug で分ける)。
-- 講師名・日時・会場・料金・定員・締切・写真・紹介文はすべて sp_ws_events に持ち、コードに直書きしない。
-- 決済の流れは BOOM DOJO(battle_entries/battle_payments)と同じ: カード=30分の仮押さえ→StripeのWebhookで確定 / 当日払い=申込で確定(未収)。
-- 既存の表は触らない(追加のみ)。

CREATE TABLE IF NOT EXISTS sp_ws_events (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  instructor_name TEXT NOT NULL DEFAULT '',
  instructor_kana TEXT NOT NULL DEFAULT '',
  instructor_from TEXT NOT NULL DEFAULT '',
  instructor_bio TEXT NOT NULL DEFAULT '',
  instructor_genre TEXT NOT NULL DEFAULT '',
  instructor_instagram TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  fee INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 0,
  entry_deadline TEXT NOT NULL DEFAULT '',
  entry_open INTEGER NOT NULL DEFAULT 0,
  belongings TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  cancel_policy TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sp_ws_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  kana TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  age INTEGER,
  is_member INTEGER NOT NULL DEFAULT 0,
  guardian_name TEXT NOT NULL DEFAULT '',
  guardian_consent INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT NOT NULL DEFAULT 'card',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  amount_total INTEGER NOT NULL DEFAULT 0,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  edit_token TEXT NOT NULL UNIQUE,
  receipt_seq INTEGER,
  expires_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sp_ws_entries_slug ON sp_ws_entries (slug, payment_status);

CREATE INDEX IF NOT EXISTS idx_sp_ws_entries_session ON sp_ws_entries (stripe_session_id);

CREATE TABLE IF NOT EXISTS sp_ws_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  payment_intent_id TEXT NOT NULL DEFAULT '',
  entry_id INTEGER,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'jpy',
  payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sp_ws_payments_session ON sp_ws_payments (stripe_session_id);

-- Myスペシャルワークショップ(TARO 2026-11-24決定)。会場は未定=空(画面では「調整中」と出す)。
-- キャンセル規定は BOOM DOJO と同じ文を仮で入れる(決まったら /staff/ws の設定で直す)。
INSERT OR IGNORE INTO sp_ws_events (
  slug, title, subtitle, instructor_name, instructor_kana, instructor_from, instructor_bio, instructor_genre, instructor_instagram,
  photo_url, description, event_date, start_time, end_time, venue, venue_address, fee, capacity, entry_deadline, entry_open,
  belongings, target, cancel_policy, contact, created_at, updated_at
) VALUES (
  'my',
  'My SPECIAL WORKSHOP',
  'from KOREA',
  'My',
  '',
  'from KOREA',
  '韓国で活躍しているダンサー。年末に仙台へ帰ってくるタイミングで、一夜かぎりのスペシャルワークショップをひらきます。
12/26(土)の BOOM DOJO 其の一 ではジャッジも担当します。',
  '',
  '',
  '',
  '韓国で活躍するダンサー My が、一夜かぎりのワークショップをひらきます。
BOOMの会員さんも、会員でない方も、どなたでも参加できます。',
  '2026-12-22', '19:30', '21:00',
  '', '',
  2000, 20,
  '2026-12-21T23:59',
  1,
  '動きやすい服
室内用のシューズ
飲み物',
  '',
  'お客様のご都合によるお申し込み後のキャンセル・返金はお受けできません。
主催者の都合でワークショップを中止した場合は、お支払いいただいた代金を全額返金します。',
  'BOOM公式LINE',
  '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:00.000Z'
);
