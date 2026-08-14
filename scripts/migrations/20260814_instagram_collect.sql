-- 会員Instagramアカウント収集 (2026-08-14)
--
-- 会員に任意で提出してもらったInstagramアカウントを、スタッフの承認を経て boom_members へ紐付ける。
--
-- 正本は boom_members.instagram_handle の1箇所。
-- instagram_submissions / instagram_entries は「回答の受信箱(生ログ)」であり参照先ではない。
-- 受信箱を残すのは誤紐付けの追跡・解除と、本人が編集URLで直したときの追随のため。
--
-- 本番は SKIP_DB_INIT=1 で initDb/runMigrations が走らないため、列追加はこの台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、各文の ; は行末に置く(行内コメント禁止)。

CREATE TABLE IF NOT EXISTS instagram_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edit_token TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instagram_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  member_name_kana TEXT NOT NULL,
  handle TEXT NOT NULL,
  owner_kind TEXT NOT NULL,
  match_state TEXT NOT NULL DEFAULT 'pending',
  matched_member_id INTEGER,
  matched_by TEXT,
  matched_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instagram_entries_submission ON instagram_entries (submission_id);

CREATE INDEX IF NOT EXISTS idx_instagram_entries_state ON instagram_entries (match_state);

CREATE TABLE IF NOT EXISTS instagram_collect_settings (
  id INTEGER PRIMARY KEY,
  is_open INTEGER NOT NULL DEFAULT 1,
  intro_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

ALTER TABLE boom_members ADD COLUMN instagram_handle TEXT;

ALTER TABLE boom_members ADD COLUMN instagram_owner_kind TEXT;

ALTER TABLE boom_members ADD COLUMN instagram_linked_at TEXT;
