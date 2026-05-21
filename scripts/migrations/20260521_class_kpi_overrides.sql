-- クラス別KPI稼働率の分類上書きテーブル
-- ダッシュボードの「平均稼働率」が、新規立ち上げクラスや異常に低い問題クラスに
-- 引っ張られて経営判断を歪める問題への対策。
-- 各クラス (program_name) を以下のカテゴリへ手動で分類できるようにする:
--   'new'     : 立ち上げ期 (直近グレース期間内・低稼働は当然なので別枠)
--   'watch'   : 要対策 (異常に低い問題クラス・別枠)
--   'normal'  : 通常 (ヘッドライン平均の母数。自動watch判定を強制的に上書きする)
--   'exclude' : 完全除外 (イベント等そもそもクラスでないもの)
--   NULL      : 自動判定 (launched_at / 稼働率しきい値で判定)
-- launched_at : クラス開始日 YYYY-MM-DD (新規立ち上げ判定用)
CREATE TABLE IF NOT EXISTS class_kpi_overrides (
  program_name TEXT PRIMARY KEY,
  category TEXT,            -- 'new' | 'watch' | 'normal' | 'exclude' (NULLなら自動判定)
  launched_at TEXT,         -- クラス開始日 YYYY-MM-DD (新規立ち上げ判定用)
  note TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
