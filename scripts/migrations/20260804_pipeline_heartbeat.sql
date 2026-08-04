-- Mac常駐パイプラインの生存記録(TARO 2026-08-04)
-- 「アプリで生成を押したのに何も起きない」= Macがスリープしていて常駐が動いていない、を
-- 画面から気づけるようにする。last_ok_at が古ければアプリ側で警告を出す。
ALTER TABLE reel_pipeline_signal ADD COLUMN last_run_at TEXT;
ALTER TABLE reel_pipeline_signal ADD COLUMN last_ok_at TEXT;
ALTER TABLE reel_pipeline_signal ADD COLUMN last_error TEXT;
