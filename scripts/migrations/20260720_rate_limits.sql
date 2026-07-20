-- レート制限テーブル (Fable改修設計 PR-5 / Phase 3 / 2026-07-20)
--
-- PINリセット等の濫用防止に使う固定窓カウンタ。eventAuth.ts の checkRateLimit が読み書きする。
-- key = 用途:識別子 (例 pinreset:203.0.113.9)、window_start = 窓の開始UNIX秒(文字列)。
--
-- 設計メモ: DDLは台帳経由(schema.ts/runMigrations は本番で走らない)。
-- 本番は SKIP_DB_INIT=1 のため、この台帳(migrate.mjs)で適用する。
-- 注: migrate.mjs は行末の ; で文を分割するため、; は行末に置く(行内コメント禁止)。

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);
