CREATE TABLE IF NOT EXISTS recital_events (
  event_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  show_date TEXT NOT NULL,
  rehearsal_date TEXT,
  venue TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  copied_from TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recital_settings (
  event_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_key, key)
);
CREATE TABLE IF NOT EXISTS recital_fee_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  payer_role TEXT NOT NULL,
  item_code TEXT NOT NULL,
  nth_from INTEGER NOT NULL,
  nth_to INTEGER,
  unit_amount INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  is_tentative INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_fee_rules_event ON recital_fee_rules (event_key, sort_order);
CREATE TABLE IF NOT EXISTS recital_works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  work_code TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  title_reading TEXT,
  title_final INTEGER,
  class_label TEXT,
  class_short TEXT,
  slot_label TEXT,
  target_label TEXT,
  genre TEXT,
  entry_mode TEXT NOT NULL DEFAULT 'form',
  fee_type TEXT NOT NULL DEFAULT 'counted',
  extra_fee INTEGER,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  merged_into INTEGER,
  public_note TEXT,
  staff_note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  duration_sec INTEGER,
  start_style TEXT,
  exit_style TEXT,
  song TEXT,
  costume TEXT,
  color1 TEXT,
  color2 TEXT,
  intro_text TEXT,
  props TEXT,
  mic INTEGER,
  smoke INTEGER,
  attack INTEGER,
  attack_sec INTEGER,
  video_sale_ok INTEGER,
  sns_post_ok INTEGER,
  line_group_url TEXT,
  lighting_plan_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_works_code ON recital_works (event_key, work_code);
CREATE TABLE IF NOT EXISTS recital_work_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  work_id INTEGER NOT NULL,
  lesson_master_id INTEGER,
  label TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_work_classes_work ON recital_work_classes (work_id);
CREATE TABLE IF NOT EXISTS recital_work_instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  work_id INTEGER NOT NULL,
  instructor_id INTEGER,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'choreo',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_work_instructors_work ON recital_work_instructors (work_id);
CREATE TABLE IF NOT EXISTS recital_households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ref_code TEXT NOT NULL,
  contact_last_name TEXT,
  contact_first_name TEXT,
  contact_last_kana TEXT,
  contact_first_kana TEXT,
  email TEXT,
  phone TEXT,
  edit_token TEXT NOT NULL,
  submit_key TEXT,
  source TEXT NOT NULL DEFAULT 'form',
  pay_method TEXT,
  bank_told_at TEXT,
  bank_told_date TEXT,
  bank_told_name TEXT,
  bank_told_amount INTEGER,
  bank_told_by TEXT,
  extend_until TEXT,
  pay_due_override TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  merged_into INTEGER,
  applied_at TEXT,
  opened_at TEXT,
  mail_opened_at TEXT,
  mail_bounced INTEGER NOT NULL DEFAULT 0,
  staff_note TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_seq ON recital_households (event_key, seq);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_ref ON recital_households (event_key, ref_code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_token ON recital_households (edit_token);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_households_submit ON recital_households (submit_key) WHERE submit_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_households_email ON recital_households (event_key, email);
CREATE INDEX IF NOT EXISTS idx_recital_households_phone ON recital_households (event_key, phone);
CREATE TABLE IF NOT EXISTS recital_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  household_id INTEGER,
  category TEXT NOT NULL,
  member_id INTEGER,
  match_status TEXT,
  instructor_link_id INTEGER,
  last_name TEXT NOT NULL,
  first_name TEXT,
  last_kana TEXT,
  first_kana TEXT,
  birthday TEXT,
  display_name TEXT,
  name_ok INTEGER NOT NULL DEFAULT 1,
  name_confirmed_at TEXT,
  photo_ok INTEGER NOT NULL DEFAULT 1,
  sns_ok INTEGER NOT NULL DEFAULT 1,
  insta_handle TEXT,
  insta_synced_at TEXT,
  tshirt_size TEXT,
  tshirt_color TEXT,
  tshirt_body TEXT,
  fee_class_override TEXT,
  staff_note TEXT,
  ext_ref TEXT,
  merged_into INTEGER,
  ending_group TEXT,
  room_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_people_seq ON recital_people (event_key, seq);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_people_ext ON recital_people (event_key, ext_ref) WHERE ext_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_people_household ON recital_people (household_id);
CREATE TABLE IF NOT EXISTS recital_casts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  person_id INTEGER NOT NULL,
  work_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  applied_at TEXT,
  decided_at TEXT,
  withdrawn_at TEXT,
  withdraw_reason TEXT,
  absent_photo INTEGER,
  sort_order INTEGER,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_casts_pw ON recital_casts (person_id, work_id);
CREATE INDEX IF NOT EXISTS idx_recital_casts_work ON recital_casts (work_id, status);
CREATE TABLE IF NOT EXISTS recital_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER NOT NULL,
  person_id INTEGER,
  item_code TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_amount INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  void_reason TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_charges_household ON recital_charges (household_id, status);
CREATE TABLE IF NOT EXISTS recital_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER,
  ticket_order_id INTEGER,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_on TEXT NOT NULL,
  source TEXT NOT NULL,
  bank_transaction_id INTEGER,
  bank_date TEXT,
  bank_desc TEXT,
  stripe_event_id TEXT,
  stripe_session_id TEXT,
  stripe_pi_id TEXT,
  payer_name_raw TEXT,
  confirmed_by TEXT,
  memo TEXT,
  created_at TEXT NOT NULL,
  CHECK ((household_id IS NULL) <> (ticket_order_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_payments_event ON recital_payments (stripe_event_id) WHERE stripe_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_payments_session ON recital_payments (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_payments_pi ON recital_payments (stripe_pi_id) WHERE stripe_pi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_payments_household ON recital_payments (household_id);
CREATE INDEX IF NOT EXISTS idx_recital_payments_bankrow ON recital_payments (bank_transaction_id);
CREATE TABLE IF NOT EXISTS recital_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER,
  person_id INTEGER,
  work_id INTEGER,
  action TEXT NOT NULL,
  received_at TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  reason TEXT,
  is_exception INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recital_changes_household ON recital_changes (household_id);
CREATE TABLE IF NOT EXISTS recital_mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER,
  instructor_link_id INTEGER,
  ticket_order_id INTEGER,
  mail_kind TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_mail_log_dedupe ON recital_mail_log (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recital_mail_log_household ON recital_mail_log (household_id, mail_kind);
CREATE TABLE IF NOT EXISTS recital_instructor_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  link_kind TEXT NOT NULL,
  instructor_id INTEGER,
  display_name TEXT,
  reading TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  email TEXT,
  access_token TEXT NOT NULL,
  last_opened_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_instructor_links_token ON recital_instructor_links (access_token);
CREATE TABLE IF NOT EXISTS recital_fee_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  fee_class TEXT NOT NULL,
  memo TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_fee_presets_member ON recital_fee_presets (event_key, member_id);
CREATE TABLE IF NOT EXISTS recital_refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason_no INTEGER NOT NULL,
  reason TEXT NOT NULL,
  waiting_reply INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo',
  payment_id INTEGER,
  source_payment_id INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_recital_refunds_household ON recital_refunds (household_id, status);
CREATE TABLE IF NOT EXISTS recital_checkouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  household_id INTEGER NOT NULL,
  stripe_session_id TEXT,
  stripe_pi_id TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_checkouts_session ON recital_checkouts (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_checkouts_pi ON recital_checkouts (stripe_pi_id) WHERE stripe_pi_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_checkouts_open ON recital_checkouts (household_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS recital_bank_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  row_date TEXT NOT NULL,
  dir TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance INTEGER,
  kind TEXT NOT NULL,
  desc_raw TEXT,
  desc_norm TEXT,
  cut INTEGER NOT NULL DEFAULT 0,
  unread TEXT,
  ref_read TEXT,
  ref_ok INTEGER NOT NULL DEFAULT 0,
  row_key TEXT NOT NULL,
  source TEXT NOT NULL,
  import_id INTEGER,
  file_seen INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'new',
  match_by TEXT,
  review_kind TEXT,
  check_flag TEXT,
  decided_by TEXT,
  decided_at TEXT,
  memo TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recital_bank_rows_key ON recital_bank_rows (event_key, row_key) WHERE state <> 'void';
CREATE INDEX IF NOT EXISTS idx_recital_bank_rows_state ON recital_bank_rows (event_key, state);
CREATE TABLE IF NOT EXISTS recital_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'statement',
  read_rows INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  existing INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT,
  imported_at TEXT,
  shot_on TEXT,
  range_from TEXT,
  range_to TEXT,
  images INTEGER,
  source TEXT,
  check_result TEXT
);
