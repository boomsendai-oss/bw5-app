-- BW6スペシャルナンバー by MOCCHIN の申込(2026-11-04)。1人1行。
-- status は active / cancelled。paid は参加費(銀行振込)の入金をスタッフが手で付ける。
-- 定員などの設定は party_settings(event_key='bw6_mocchin')に置く。
CREATE TABLE IF NOT EXISTS mocchin_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  status         TEXT    NOT NULL DEFAULT 'active',
  name           TEXT    NOT NULL,
  kana           TEXT    NOT NULL,
  age            TEXT    NOT NULL,
  guardian_name  TEXT    NOT NULL DEFAULT '',
  phone          TEXT    NOT NULL,
  email          TEXT    NOT NULL,
  is_member      INTEGER NOT NULL DEFAULT 0,
  member_no      TEXT    NOT NULL DEFAULT '',
  dance_history  TEXT    NOT NULL DEFAULT '',
  class_number   TEXT    NOT NULL DEFAULT 'undecided',
  note           TEXT    NOT NULL DEFAULT '',
  paid           INTEGER NOT NULL DEFAULT 0,
  paid_at        TEXT    NOT NULL DEFAULT '',
  staff_note     TEXT    NOT NULL DEFAULT '',
  applied_on     TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mocchin_entries_status ON mocchin_entries (status, id);
