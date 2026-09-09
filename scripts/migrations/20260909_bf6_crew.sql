-- BF6 当日オペ用クルー認証(2026-09-09)
--
-- 当日だけ手伝うスタッフに /staff の管理パスワードを渡すと、会員名簿・収支・決済まで
-- 見えてしまう。当日オペ(受付・写真・くじ・LED)だけを /bf6/crew に切り出し、
-- 別系統のPINで入れるようにするためのセッション置き場。
-- admin_sessions とは分ける(cookie名もスコープも別)。

CREATE TABLE IF NOT EXISTS bf_crew_sessions (
  token      TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_bf_crew_sessions_exp ON bf_crew_sessions (expires_at);
