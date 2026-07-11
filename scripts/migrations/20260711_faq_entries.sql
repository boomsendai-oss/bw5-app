-- WS O: FAQ AIチャットボット「BOOMくんに質問」の正本テーブル
-- HP FAQ・料金・入会情報の一元管理。is_public=1 のみ公開抽出(/api/public/knowledge)へ流れる

CREATE TABLE IF NOT EXISTS faq_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,            -- 体験 / 入会 / 料金・支払い / レッスン / その他
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,  -- 1=ボット・HPへ公開 / 0=下書き
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_entries_public ON faq_entries(is_public, category, sort_order);
