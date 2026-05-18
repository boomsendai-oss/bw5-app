-- スタジオ・インストラクター・レッスンのマスターデータ + 月別実開催インスタンス
-- 既存 lesson_schedule は段階移行し、最終的に lesson_master + lesson_instances に置き換え

-- ============================================
-- スタジオ
-- ============================================
CREATE TABLE IF NOT EXISTS studios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  google_map_url TEXT,
  pricing_model TEXT NOT NULL DEFAULT 'hourly',
  hourly_rate INTEGER DEFAULT 0,
  block_pricing TEXT,
  daily_buffer_minutes INTEGER DEFAULT 0,
  notes TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- インストラクター
-- ============================================
CREATE TABLE IF NOT EXISTS instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_kana TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  instagram_handle TEXT,
  profile_text TEXT,
  profile_photo_url TEXT,
  shared_folder_url TEXT,
  bank_name TEXT,
  bank_branch TEXT,
  bank_account_type TEXT,
  bank_account_number TEXT,
  bank_account_holder TEXT,
  notes TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- インストラクター × レッスン長 → 単価
-- ============================================
CREATE TABLE IF NOT EXISTS instructor_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  rate INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(instructor_id, duration_minutes)
);

-- ============================================
-- インストラクター × スタジオ → 交通費
-- ============================================
CREATE TABLE IF NOT EXISTS instructor_transit_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id INTEGER NOT NULL,
  studio_id INTEGER NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(instructor_id, studio_id)
);

-- ============================================
-- レッスンマスター (定常クラス)
-- ============================================
CREATE TABLE IF NOT EXISTS lesson_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL,
  target TEXT,
  level TEXT,
  default_studio_id INTEGER,
  default_instructor_id INTEGER,
  default_day_of_week INTEGER,
  default_start_time TEXT,
  default_end_time TEXT,
  duration_minutes INTEGER,
  frequency_type TEXT,
  rrule TEXT,
  override_rate INTEGER,
  active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- レッスン実開催インスタンス (月別)
-- ============================================
CREATE TABLE IF NOT EXISTS lesson_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id INTEGER,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  studio_id INTEGER,
  instructor_id INTEGER,
  status TEXT DEFAULT 'scheduled',
  attendance_count INTEGER DEFAULT 0,
  transit_fee_override INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lesson_instances_date ON lesson_instances(date);
CREATE INDEX IF NOT EXISTS idx_lesson_instances_master ON lesson_instances(master_id);
CREATE INDEX IF NOT EXISTS idx_lesson_instances_instructor ON lesson_instances(instructor_id);
