-- HACOMONO スケジュールインポートCSV 変換用マッピングテーブル
-- BW5マスタースケジュール (lesson_master / lesson_instances) を
-- HACOMONO スケジュールインポート形式CSV に変換する際の
-- BW5キー (class_name / instructor名 / studio名) → HACOMONOコード対応表。
--
-- entity_type:
--   'program' : BW5 class_name      -> HACOMONO プログラムコード (PGxxxx)
--   'staff'   : BW5 instructor.name -> HACOMONO スタッフコード   (INxxxx)
--   'space'   : BW5 studio.name     -> HACOMONO スペースコード   (S0001_SPxxxx)
-- bw5_key    : BW5側の文字列 (class_name / instructor名 / studio名)
-- hacomono_code : HACOMONOコード
-- hacomono_name : HACOMONO側の名称 (参照用)
-- notes      : 補足
CREATE TABLE IF NOT EXISTS hacomono_schedule_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  bw5_key TEXT NOT NULL,
  hacomono_code TEXT NOT NULL,
  hacomono_name TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, bw5_key)
);

CREATE INDEX IF NOT EXISTS idx_hacomono_map_type ON hacomono_schedule_map(entity_type);
