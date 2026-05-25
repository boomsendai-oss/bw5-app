-- 月の確定/凍結 (Phase2 ①)
--
-- 目的: ある月のレッスン予定を「確定」してスナップショット化する。
--   確定すると lesson_master の変更がその月のカレンダー/給与/スタジオ料金/エクスポートに
--   遡って反映されなくなる (= 凍結)。
--
-- 仕組み:
--   1. 確定時に、その月の master 週次展開で表示されている分を lesson_instances として
--      実体化 (materialize) する → 以降は instance のみがソースになる。
--   2. month_confirmations に year_month を記録する。
--   3. 各展開サイト (calendar route / payroll / studioBilling / scheduleExport) は
--      確定済み月では master 週次展開をスキップし、instance のみを使う。
--
-- 注意: 「確定」は master 変更の遡及反映を止めるだけ。
--   手動編集 (編集/休講/削除/移動/全休/追加) は確定後も常に可能。
--   「確定解除」で行を消せば master 展開が再開する (= master と再同期)。
CREATE TABLE IF NOT EXISTS month_confirmations (
  year_month TEXT PRIMARY KEY,           -- 'YYYY-MM'
  confirmed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  materialized_count INTEGER DEFAULT 0,  -- 確定時に実体化した instance 件数 (監査用)
  note TEXT
);
