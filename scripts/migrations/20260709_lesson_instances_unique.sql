-- A-6: lesson_instances に (master_id, date) の UNIQUE 制約を追加。
-- 複数Claudeセッションが月確定(materializeMonth)を並行実行すると同一レッスンが
-- 二重instance化し、給与・スタジオ使用料が最大2倍計上される経路があった。
-- master_id が NULL の手動instance(単発)は対象外(部分INDEX)。
-- ※ 適用前に本番で重複0件を確認済み(2026-07-08)。materialize/移動系の
--   INSERT は INSERT OR IGNORE 化して冪等にする(コード側で対応)。
CREATE UNIQUE INDEX IF NOT EXISTS idx_li_master_date
  ON lesson_instances (master_id, date)
  WHERE master_id IS NOT NULL;
