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

-- 実物HACOMONOエクスポートCSV準拠の追加属性 (program行に格納する)
-- HACOMONOのスケジュールは「プログラム」がスタッフ/スペース/各種フラグを規定するため、
-- BW5 class_name -> program 行に既定のスタッフ・スペース・トライアル数・各フラグを持たせる。
--   default_staff_code  : 既定スタッフコード (BW5側instructorが解決できなければこれを使う)
--   default_space_code  : 既定スペースコード (実物では program がスペースを規定)
--   trial_capacity      : トライアル予約可能数
--   space_selectable    : スペースの選択が可能かどうか (1/0)
--   space_movable       : キャンセル受付終了後のスペース移動を許可するか (1/0)
--   publish_fixed       : 公開日時を固定値で出すか (1=固定値, 0=空欄)
ALTER TABLE hacomono_schedule_map ADD COLUMN default_staff_code TEXT;
ALTER TABLE hacomono_schedule_map ADD COLUMN default_space_code TEXT;
ALTER TABLE hacomono_schedule_map ADD COLUMN trial_capacity INTEGER;
ALTER TABLE hacomono_schedule_map ADD COLUMN space_selectable INTEGER;
ALTER TABLE hacomono_schedule_map ADD COLUMN space_movable INTEGER;
ALTER TABLE hacomono_schedule_map ADD COLUMN publish_fixed INTEGER;
