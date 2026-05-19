-- ============================================
-- 防御フェーズ拡張 (2026-05-19)
-- - KPIダッシュボード A-E
-- - インストラクター専用ポータル
-- - 給与計算 / スタジオ料計算 / 経費管理 / 銀行明細取込
-- ============================================

-- --------------------------------------------
-- 既存テーブルの拡張
-- --------------------------------------------

-- インストラクター: 給与形態・認証情報・明細フォルダ
ALTER TABLE instructors ADD COLUMN salary_type TEXT DEFAULT 'per_lesson';      -- per_lesson | monthly_fixed
ALTER TABLE instructors ADD COLUMN monthly_fixed_amount INTEGER DEFAULT 0;
ALTER TABLE instructors ADD COLUMN birth_date TEXT;                            -- YYYY-MM-DD (初回ログイン)
ALTER TABLE instructors ADD COLUMN pin_hash TEXT;                              -- 4-6桁PINのハッシュ
ALTER TABLE instructors ADD COLUMN pin_set_at TEXT;
ALTER TABLE instructors ADD COLUMN payslip_folder_url TEXT;                    -- 給与明細PDFのアップ先

-- スタジオ: 支払い区分
ALTER TABLE studios ADD COLUMN payment_type TEXT DEFAULT 'postpaid_bank';      -- prepaid_bank | postpaid_bank | cash_per_use | postpaid_public

-- --------------------------------------------
-- 稼働率 (HACOMONO RS002 キャッシュ)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS lesson_utilization (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_date TEXT NOT NULL,             -- YYYY-MM-DD
  start_time TEXT NOT NULL,              -- HH:MM
  end_time TEXT,
  program_code TEXT,
  program_name TEXT,
  staff_code TEXT,
  staff_name TEXT,
  studio_code TEXT,
  studio_name TEXT,
  capacity INTEGER,                      -- スペース数(=定員)
  total_reservations INTEGER,
  checkin_count INTEGER,
  no_show_count INTEGER,
  cancel_count INTEGER,
  waitlist_count INTEGER,
  trial_count INTEGER,
  utilization_rate REAL,                 -- 0.0 - 1.0
  source TEXT DEFAULT 'rs002',
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(lesson_date, start_time, program_code, staff_code)
);
CREATE INDEX IF NOT EXISTS idx_util_date ON lesson_utilization(lesson_date);
CREATE INDEX IF NOT EXISTS idx_util_program ON lesson_utilization(program_code);
CREATE INDEX IF NOT EXISTS idx_util_staff ON lesson_utilization(staff_code);

-- --------------------------------------------
-- HACOMONO 課金明細 (プラン/単発/入会金の内訳)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS hacomono_billing_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_date TEXT NOT NULL,            -- YYYY-MM-DD
  member_id TEXT,                        -- HACOMONOメンバーID
  kaiin_no TEXT,                         -- 会員番号
  product_name TEXT,                     -- 商品名(プラン/チケット/入会金)
  product_category TEXT,                 -- plan | ticket | enrollment_fee | other
  amount INTEGER NOT NULL,               -- 金額(税込)
  payment_method TEXT,
  status TEXT,                           -- 確定 | キャンセル | 返金 等
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(billing_date, member_id, product_name, amount)
);
CREATE INDEX IF NOT EXISTS idx_billing_date ON hacomono_billing_records(billing_date);
CREATE INDEX IF NOT EXISTS idx_billing_category ON hacomono_billing_records(product_category);

-- --------------------------------------------
-- GMO青空ネット銀行 取引明細
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_date TEXT NOT NULL,                -- YYYY-MM-DD
  amount INTEGER NOT NULL,               -- マイナス=出金, プラス=入金
  description TEXT,                      -- 摘要
  counterparty TEXT,                     -- 振込元/振込先
  balance_after INTEGER,
  expense_category TEXT,                 -- 自動推定 or 手動修正
  confirmed INTEGER DEFAULT 0,           -- 0=未確認 1=経費登録済み
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(txn_date, amount, description)
);
CREATE INDEX IF NOT EXISTS idx_bank_date ON bank_transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_bank_category ON bank_transactions(expense_category);

-- --------------------------------------------
-- 経費管理
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date TEXT NOT NULL,            -- YYYY-MM-DD
  category TEXT NOT NULL,                -- 広告費 | システム費 | 通信費 | 備品 | 給与 | スタジオ料 | その他
  subcategory TEXT,                      -- 媒体名/サブスク名/スタジオ名 等
  amount INTEGER NOT NULL,
  description TEXT,
  source TEXT,                           -- manual | bank_txn | payroll | studio_billing
  source_ref_id INTEGER,                 -- 関連レコードID
  is_recurring INTEGER DEFAULT 0,        -- 月次自動計上対象
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_exp_category ON expenses(category);

-- 月次固定費(recurring) のテンプレート
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  subcategory TEXT,
  amount INTEGER NOT NULL,
  description TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 広告媒体マスタ & 広告費
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ad_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,             -- Google Ads / Meta / LINE広告 / Wix Booster / Other
  active INTEGER DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS ad_spends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  year_month TEXT NOT NULL,              -- YYYY-MM
  amount INTEGER NOT NULL,
  impressions INTEGER,
  clicks INTEGER,
  conversions INTEGER,                   -- 媒体側CV
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel_id, year_month)
);

-- --------------------------------------------
-- 月次給与計算
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month TEXT NOT NULL,              -- YYYY-MM (締め月)
  instructor_id INTEGER NOT NULL,
  total_lesson_amount INTEGER DEFAULT 0,
  total_transit_amount INTEGER DEFAULT 0,
  total_adjustment_amount INTEGER DEFAULT 0,
  total_amount INTEGER DEFAULT 0,
  payment_date TEXT,                     -- 振込予定日 (翌月15日)
  status TEXT DEFAULT 'draft',           -- draft | confirmed | paid
  pdf_url TEXT,                          -- Drive URL
  generated_at TEXT,
  paid_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year_month, instructor_id)
);
CREATE INDEX IF NOT EXISTS idx_payroll_ym ON payroll_runs(year_month);

-- 給与明細の各行(レッスン単位)
CREATE TABLE IF NOT EXISTS payroll_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id INTEGER NOT NULL,
  lesson_date TEXT NOT NULL,
  class_name TEXT,
  duration_minutes INTEGER,
  studio_name TEXT,
  lesson_rate INTEGER DEFAULT 0,
  transit_fee INTEGER DEFAULT 0,
  source TEXT,                           -- lesson_instance | lesson_master_expanded
  source_ref_id INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(payroll_run_id);

-- 給与調整項目 (イベント手当・代講料・特別レッスン単価上書き等)
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL,         -- event_bonus | substitute_fee | special_lesson | deduction | other
  amount INTEGER NOT NULL,               -- 加算+/減算-
  description TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payroll_adj_run ON payroll_adjustments(payroll_run_id);

-- --------------------------------------------
-- 月次スタジオ料金計算
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS studio_billing_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month TEXT NOT NULL,
  studio_id INTEGER NOT NULL,
  total_hours REAL DEFAULT 0,
  total_lesson_amount INTEGER DEFAULT 0,
  total_adjustment_amount INTEGER DEFAULT 0,
  total_amount INTEGER DEFAULT 0,
  payment_date TEXT,
  status TEXT DEFAULT 'draft',
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year_month, studio_id)
);

CREATE TABLE IF NOT EXISTS studio_billing_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studio_billing_run_id INTEGER NOT NULL,
  lesson_date TEXT NOT NULL,
  class_name TEXT,
  hours REAL,
  hourly_rate INTEGER,
  amount INTEGER,
  source TEXT,
  source_ref_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_studio_billing_lines_run ON studio_billing_lines(studio_billing_run_id);

CREATE TABLE IF NOT EXISTS studio_billing_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studio_billing_run_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL,         -- cancellation_fee | extra_rental | discount | other
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- KPI 目標値
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_key TEXT NOT NULL,              -- members_active | monthly_revenue | churn_rate | trial_cvr 等
  year_month TEXT NOT NULL,              -- YYYY-MM
  target_value REAL NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(metric_key, year_month)
);

-- --------------------------------------------
-- インストラクター専用ポータル: セッション
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS instructor_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id INTEGER NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_instr_sess_token ON instructor_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_instr_sess_instr ON instructor_sessions(instructor_id);

-- PINリセットトークン (メール送信式)
CREATE TABLE IF NOT EXISTS instructor_pin_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id INTEGER NOT NULL,
  reset_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 休講申請
CREATE TABLE IF NOT EXISTS lesson_cancel_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instructor_id INTEGER NOT NULL,
  lesson_date TEXT NOT NULL,
  master_id INTEGER,
  instance_id INTEGER,
  reason TEXT,
  substitute_instructor_id INTEGER,
  status TEXT DEFAULT 'pending',         -- pending | approved | rejected
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cancel_req_instr ON lesson_cancel_requests(instructor_id);
CREATE INDEX IF NOT EXISTS idx_cancel_req_status ON lesson_cancel_requests(status);
