-- メロジョイ(Mellojoy Japan 公式ストア)の在庫見張り(2026-10-24 TARO依頼)。
-- クリパの景品用。ストアは毎日12:00に在庫更新・入荷は数秒〜数分で売り切れるため、
-- 公開JSON(products.json)を読むだけで見張り、入荷したらPushoverで知らせる。カート投入・購入は一切しない。
-- state = バリエーションごとの最新状態 / events = 入荷・売り切れ等の履歴(入荷パターンを学ぶため)。
CREATE TABLE IF NOT EXISTS mellojoy_watch_state (
  variant_id         TEXT PRIMARY KEY,
  product_title      TEXT,
  variant_title      TEXT,
  handle             TEXT,
  price              TEXT,
  available          INTEGER,
  last_change_at     TEXT,
  last_seen_at       TEXT,
  variant_updated_at TEXT
);
CREATE TABLE IF NOT EXISTS mellojoy_watch_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT,
  kind          TEXT,
  variant_id    TEXT,
  product_title TEXT,
  price         TEXT,
  detail        TEXT
);
CREATE INDEX IF NOT EXISTS idx_mellojoy_watch_events_at ON mellojoy_watch_events (at);
