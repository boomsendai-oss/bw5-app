-- 月1回の校内プチバトル(/battle)の申込。毎月使い回すので event_key(例 2026-12-26)で回を分ける。
-- イベント名・説明・日付・部門・料金・定員はすべて battle_events に持ち、コードに直書きしない。
-- 決済の流れはBF7(bf7_orders/bf7_payments)と同じ。既存テーブルは触らない(追加のみ)。

CREATE TABLE IF NOT EXISTS battle_events (
  event_key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  open_time TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  venue_address TEXT NOT NULL DEFAULT '',
  move_seconds INTEGER NOT NULL DEFAULT 0,
  divisions TEXT NOT NULL DEFAULT '[]',
  entry_fee INTEGER NOT NULL DEFAULT 0,
  entry_fee_late INTEGER NOT NULL DEFAULT 0,
  late_fee_from TEXT NOT NULL DEFAULT '',
  spectator_fee INTEGER NOT NULL DEFAULT 0,
  spectator_note TEXT NOT NULL DEFAULT '',
  entry_deadline TEXT NOT NULL DEFAULT '',
  entry_open INTEGER NOT NULL DEFAULT 0,
  rules TEXT NOT NULL DEFAULT '',
  cancel_policy TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS battle_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  email TEXT NOT NULL,
  dancer_name TEXT NOT NULL,
  dancer_kana TEXT NOT NULL DEFAULT '',
  real_name TEXT NOT NULL DEFAULT '',
  birthdate TEXT NOT NULL DEFAULT '',
  rep TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  divisions TEXT NOT NULL DEFAULT '[]',
  no_win_confirmed INTEGER NOT NULL DEFAULT 0,
  spectators INTEGER NOT NULL DEFAULT 0,
  spectators_preschool INTEGER NOT NULL DEFAULT 0,
  guardian_name TEXT NOT NULL DEFAULT '',
  guardian_consent INTEGER NOT NULL DEFAULT 0,
  entry_unit INTEGER NOT NULL DEFAULT 0,
  spectator_unit INTEGER NOT NULL DEFAULT 0,
  amount_total INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  edit_token TEXT NOT NULL UNIQUE,
  stripe_session_id TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_battle_entries_event ON battle_entries (event_key, payment_status);

CREATE INDEX IF NOT EXISTS idx_battle_entries_session ON battle_entries (stripe_session_id);

CREATE TABLE IF NOT EXISTS battle_payments (
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

CREATE INDEX IF NOT EXISTS idx_battle_payments_session ON battle_payments (stripe_session_id);

-- 第1回(2026-12-26)。イベント名=BOOM DOJO -ROAD TO BLACK BELT-(TARO 2026-11-19決定)。受付は「閉」で入れ、スタッフ画面で開ける。
-- 料金は仮(TARO 2026-11-19)。決まったら /staff/battle の設定で直す。
INSERT OR IGNORE INTO battle_events (
  event_key, title, subtitle, description, event_date, open_time, start_time, end_time,
  venue, venue_address, move_seconds, divisions, entry_fee, entry_fee_late, late_fee_from,
  spectator_fee, spectator_note, entry_deadline, entry_open, rules, cancel_policy, created_at, updated_at
) VALUES (
  '2026-12-26',
  'BOOM DOJO',
  'ROAD TO BLACK BELT ─ 優勝未経験者限定 1on1 バトル',
  'BOOMダンススクールが毎月ひらく、優勝未経験のダンサーのための道場（バトル）です。
はじめてのバトルにも、次の一歩にも。会員・会員以外どなたでも参加できます。',
  '2026-12-26', '14:00', '14:40', '18:00',
  'GOAT DANCE STUDIO Aスタジオ', '仙台市青葉区本町1-9-23 BFEビル3F',
  45,
  '[{"key":"u12","name":"優勝未経験 U12 ALL STYLE 1on1","note":"開催日に12歳以下","capacity":16,"maxAge":12},{"key":"open","name":"優勝未経験 ALL AGE ALL STYLE 1on1","note":"年齢制限なし","capacity":16,"maxAge":null}]',
  2000, 2500, '2026-12-25T18:00',
  1000, '未就学児は無料',
  '2026-12-25T18:00',
  0,
  '参加できるのは「優勝未経験」の方です。過去にソロバトルで優勝したことがあるジャンルでは出場できません(ほかのジャンルなら出場できます)。
2部門ともエントリーできます(エントリー料は部門ごとにかかります)。',
  'お客様のご都合によるお申し込み後のキャンセル・返金はお受けできません。
主催者の都合でイベントを中止した場合は、お支払いいただいた代金を全額返金します。',
  '2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'
);
