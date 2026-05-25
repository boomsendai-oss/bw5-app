import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';

let client: Client | null = null;
let initialized = false;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (url) {
      client = createClient({
        url,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
    } else {
      client = createClient({ url: 'file:./data/bw5.db' });
    }
  }
  return client;
}

export async function initDb(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const c = getClient();

  await c.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS merchandise (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      image_url TEXT DEFAULT '',
      stock INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS merch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      variant_id INTEGER,
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      buyer_name TEXT NOT NULL,
      email TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      square_payment_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS merch_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      stock INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS video_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS vote_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS vote_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      candidate_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS music_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      jacket_url TEXT DEFAULT '',
      apple_music_url TEXT DEFAULT '',
      spotify_url TEXT DEFAULT '',
      amazon_music_url TEXT DEFAULT '',
      youtube_music_url TEXT DEFAULT '',
      release_at TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS sns_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS pamphlet_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS performances (
      m_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      title_reading TEXT DEFAULT '',
      instructor TEXT DEFAULT '',
      instructor_photo_url TEXT DEFAULT '',
      performer_count INTEGER DEFAULT 0,
      genre TEXT DEFAULT '',
      song_name TEXT DEFAULT '',
      part INTEGER DEFAULT 1
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS performers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      m_id TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (m_id) REFERENCES performances(m_id)
    )`,
      args: [],
    },
    {
      // 抽選エントリー (1人1回, fingerprint で重複防止)
      sql: `CREATE TABLE IF NOT EXISTS lottery_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      ip TEXT DEFAULT '',
      won INTEGER DEFAULT 0,
      prize_name TEXT DEFAULT '',
      prize_tier TEXT DEFAULT 'normal',
      winner_name TEXT DEFAULT '',
      keyword_used TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      // 舞台裏ライブフォト
      sql: `CREATE TABLE IF NOT EXISTS backstage_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_url TEXT NOT NULL,
      caption TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      uploaded_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      // 映像データ販売の事前予約（後日メールで案内）
      sql: `CREATE TABLE IF NOT EXISTS video_preorders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      buyer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'waiting',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    )`,
      args: [],
    },
    {
      // === Event運営アプリ (Phase 1) — 既存テーブルとは独立。ALTER不可、IF NOT EXISTS のみ ===
      sql: `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      event_date TEXT,
      status TEXT DEFAULT 'planning',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      category TEXT,
      fact TEXT,
      cause TEXT,
      action TEXT NOT NULL,
      assignee TEXT,
      priority TEXT,
      due_period TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (event_id) REFERENCES events(id)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_staff_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      staff_name TEXT,
      is_lead INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id)
    )`,
      args: [],
    },
    {
      // === KPIダッシュボード (Phase 1 MVP) — 月次手動入力ベース ===
      sql: `CREATE TABLE IF NOT EXISTS kpi_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT NOT NULL UNIQUE,
      line_friends INTEGER DEFAULT 0,
      hacomono_members_active INTEGER DEFAULT 0,
      hacomono_members_retired INTEGER DEFAULT 0,
      monthly_revenue INTEGER DEFAULT 0,
      monthly_expense INTEGER DEFAULT 0,
      monthly_profit INTEGER DEFAULT 0,
      trial_count INTEGER DEFAULT 0,
      new_signup_count INTEGER DEFAULT 0,
      retention_count INTEGER DEFAULT 0,
      churn_count INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )`,
      args: [],
    },
    {
      // === BOOM常設運営 (会員DB + Lstep連携) ===
      sql: `CREATE TABLE IF NOT EXISTS boom_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hacomono_member_id TEXT NOT NULL UNIQUE,
      hacomono_kaiin_no TEXT,
      full_name TEXT NOT NULL,
      full_name_kana TEXT NOT NULL,
      birthday TEXT,
      email TEXT,
      phone TEXT,
      enrolled_at TEXT,
      withdrew_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS lstep_friends (
      lstep_id TEXT PRIMARY KEY,
      display_name TEXT,
      system_display_name TEXT,
      line_register_name TEXT,
      real_name TEXT,
      role TEXT,
      blocked INTEGER DEFAULT 0,
      last_message_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS member_lstep_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      lstep_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence TEXT,
      confirmed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(member_id, lstep_id)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS trial_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lstep_id TEXT,
      member_id INTEGER,
      reserved_at TEXT NOT NULL,
      lesson_name TEXT,
      status TEXT,
      status_source TEXT,
      status_updated_at TEXT,
      enrolled_after INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS lstep_phase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lstep_id TEXT NOT NULL,
      old_phase TEXT,
      new_phase TEXT NOT NULL,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      source TEXT
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_members_kana ON boom_members(full_name_kana)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_members_status ON boom_members(status)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_lstep_role ON lstep_friends(role)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_links_member ON member_lstep_links(member_id)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_links_lstep ON member_lstep_links(lstep_id)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_trial_member ON trial_records(member_id)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_trial_lstep ON trial_records(lstep_id)`, args: [] },
    // (lstep_id, reserved_at) の重複防止 — 体験予約CSV自動取込で同一予約が複数行入らないように
    { sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_lstep_reserved_at ON trial_records(lstep_id, reserved_at)`, args: [] },
    {
      // === レッスンスケジュール管理 (Phase 1) — 通常パターン + 例外を1テーブルで表現 ===
      sql: `CREATE TABLE IF NOT EXISTS lesson_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week INTEGER,
      start_time TEXT,
      end_time TEXT,
      class_name TEXT NOT NULL,
      target TEXT,
      location TEXT,
      instructor TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      exception_date TEXT,
      exception_type TEXT,
      override_start_time TEXT,
      override_end_time TEXT,
      override_location TEXT,
      override_instructor TEXT,
      base_schedule_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_lesson_day ON lesson_schedule(day_of_week)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_lesson_exception ON lesson_schedule(exception_date)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_lesson_status ON lesson_schedule(status)`, args: [] },
    {
      sql: `CREATE TABLE IF NOT EXISTS lesson_schedule_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      changed_by TEXT,
      before_json TEXT,
      after_json TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_lesson_history_sched ON lesson_schedule_history(schedule_id)`, args: [] },
    {
      // === Lstep CSV原本スナップショット (cp932/2行ヘッダ含む全文を保存) ===
      // 突合実行ごとにINSERT。lstep_import ダウンロード時に最新行をベースに差分反映する
      sql: `CREATE TABLE IF NOT EXISTS lstep_csv_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      csv_text TEXT NOT NULL,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_lstep_snap_at ON lstep_csv_snapshots(uploaded_at)`, args: [] },
    {
      // === 月次運用レポート (自動生成) ===
      // year_month は "YYYY-MM" (UNIQUE)。同月再生成は UPSERT で上書き。
      sql: `CREATE TABLE IF NOT EXISTS monthly_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_month TEXT UNIQUE NOT NULL,
      report_markdown TEXT NOT NULL,
      generated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    // ============================================
    // 防御フェーズ拡張テーブル (2026-05-19)
    // ============================================
    { sql: `CREATE TABLE IF NOT EXISTS lesson_utilization (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      program_code TEXT,
      program_name TEXT,
      staff_code TEXT,
      staff_name TEXT,
      studio_code TEXT,
      studio_name TEXT,
      capacity INTEGER,
      total_reservations INTEGER,
      checkin_count INTEGER,
      no_show_count INTEGER,
      cancel_count INTEGER,
      waitlist_count INTEGER,
      trial_count INTEGER,
      utilization_rate REAL,
      source TEXT DEFAULT 'rs002',
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lesson_date, start_time, program_code, staff_code)
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_util_date ON lesson_utilization(lesson_date)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_util_program ON lesson_utilization(program_code)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_util_staff ON lesson_utilization(staff_code)`, args: [] },

    // クラス別KPI稼働率の分類上書き (2026-05-21)
    // ダッシュボードの平均稼働率を「通常クラス」のみで算出するための分類。
    // category: 'new'|'watch'|'normal'|'exclude' (NULLなら launched_at/しきい値で自動判定)
    { sql: `CREATE TABLE IF NOT EXISTS class_kpi_overrides (
      program_name TEXT PRIMARY KEY,
      category TEXT,
      launched_at TEXT,
      note TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS hacomono_billing_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      billing_date TEXT NOT NULL,
      member_id TEXT,
      kaiin_no TEXT,
      product_name TEXT,
      product_category TEXT,
      amount INTEGER NOT NULL,
      payment_method TEXT,
      status TEXT,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(billing_date, member_id, product_name, amount)
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_billing_date ON hacomono_billing_records(billing_date)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_billing_category ON hacomono_billing_records(product_category)`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS bank_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txn_date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT,
      counterparty TEXT,
      balance_after INTEGER,
      expense_category TEXT,
      confirmed INTEGER DEFAULT 0,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(txn_date, amount, description)
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_bank_date ON bank_transactions(txn_date)`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT,
      amount INTEGER NOT NULL,
      description TEXT,
      source TEXT,
      source_ref_id INTEGER,
      is_recurring INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(expense_date)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_exp_category ON expenses(category)`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS recurring_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      subcategory TEXT,
      amount INTEGER NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS ad_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER DEFAULT 1,
      notes TEXT
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS ad_spends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      year_month TEXT NOT NULL,
      amount INTEGER NOT NULL,
      impressions INTEGER,
      clicks INTEGER,
      conversions INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel_id, year_month)
    )`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS payroll_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_month TEXT NOT NULL,
      instructor_id INTEGER NOT NULL,
      total_lesson_amount INTEGER DEFAULT 0,
      total_transit_amount INTEGER DEFAULT 0,
      total_adjustment_amount INTEGER DEFAULT 0,
      total_amount INTEGER DEFAULT 0,
      payment_date TEXT,
      status TEXT DEFAULT 'draft',
      pdf_url TEXT,
      generated_at TEXT,
      paid_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year_month, instructor_id)
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_payroll_ym ON payroll_runs(year_month)`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS payroll_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_run_id INTEGER NOT NULL,
      lesson_date TEXT NOT NULL,
      class_name TEXT,
      duration_minutes INTEGER,
      studio_name TEXT,
      lesson_rate INTEGER DEFAULT 0,
      transit_fee INTEGER DEFAULT 0,
      source TEXT,
      source_ref_id INTEGER,
      notes TEXT
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(payroll_run_id)`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_run_id INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS studio_billing_runs (
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
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS studio_billing_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_billing_run_id INTEGER NOT NULL,
      lesson_date TEXT NOT NULL,
      class_name TEXT,
      hours REAL,
      hourly_rate INTEGER,
      amount INTEGER,
      source TEXT,
      source_ref_id INTEGER
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS studio_billing_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studio_billing_run_id INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS kpi_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_key TEXT NOT NULL,
      year_month TEXT NOT NULL,
      target_value REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(metric_key, year_month)
    )`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS instructor_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instructor_id INTEGER NOT NULL,
      session_token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_instr_sess_token ON instructor_sessions(session_token)`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS instructor_pin_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instructor_id INTEGER NOT NULL,
      reset_token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS hacomono_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_type TEXT NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      category TEXT,
      active INTEGER DEFAULT 1,
      notes TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_type, name)
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_hacomono_products_type ON hacomono_products(product_type)`, args: [] },

    { sql: `CREATE TABLE IF NOT EXISTS lesson_cancel_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instructor_id INTEGER NOT NULL,
      lesson_date TEXT NOT NULL,
      master_id INTEGER,
      instance_id INTEGER,
      reason TEXT,
      substitute_instructor_id INTEGER,
      status TEXT DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, args: [] },

    {
      // === HACOMONO スケジュールインポートCSV 変換用マッピング ===
      // BW5の class_name / instructor名 / studio名 → HACOMONOコード対応表。
      // entity_type: 'program' | 'staff' | 'space'
      sql: `CREATE TABLE IF NOT EXISTS hacomono_schedule_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      bw5_key TEXT NOT NULL,
      hacomono_code TEXT NOT NULL,
      hacomono_name TEXT,
      notes TEXT,
      default_staff_code TEXT,
      default_space_code TEXT,
      trial_capacity INTEGER,
      space_selectable INTEGER,
      space_movable INTEGER,
      publish_fixed INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(entity_type, bw5_key)
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_hacomono_map_type ON hacomono_schedule_map(entity_type)`, args: [] },
    {
      // 売り切れ商品の追加注文（後日発送）
      sql: `CREATE TABLE IF NOT EXISTS restock_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merch_id INTEGER NOT NULL,
      variant_id INTEGER,
      color TEXT DEFAULT '',
      size TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      buyer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      address TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      shipping_fee INTEGER NOT NULL DEFAULT 800,
      total_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending_payment',
      payment_deadline TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (merch_id) REFERENCES merchandise(id)
    )`,
      args: [],
    },
    {
      // === 月の確定/凍結 (Phase2 ①) ===
      // ある月を「確定」するとレッスン予定をスナップショット化(materialize)し、
      // lesson_master の変更がその月へ遡及反映されないようにする。
      // 各展開サイト(calendar/payroll/studioBilling/scheduleExport)は確定済み月で
      // master 週次展開をスキップし instance のみを使う。手動編集は確定後も常に可能。
      sql: `CREATE TABLE IF NOT EXISTS month_confirmations (
      year_month TEXT PRIMARY KEY,
      confirmed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      materialized_count INTEGER DEFAULT 0,
      note TEXT
    )`,
      args: [],
    },
  ], 'write');

  // ============================================
  // 既存テーブルの列追加 (冪等)
  // ============================================
  await addColumnIfMissing(c, 'instructors', 'salary_type', "TEXT DEFAULT 'per_lesson'");
  await addColumnIfMissing(c, 'instructors', 'monthly_fixed_amount', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'instructors', 'birth_date', 'TEXT');
  await addColumnIfMissing(c, 'instructors', 'pin_hash', 'TEXT');
  await addColumnIfMissing(c, 'instructors', 'pin_set_at', 'TEXT');
  await addColumnIfMissing(c, 'instructors', 'payslip_folder_url', 'TEXT');
  await addColumnIfMissing(c, 'instructors', 'bank_code', 'TEXT');
  await addColumnIfMissing(c, 'recurring_expenses', 'match_pattern', 'TEXT');
  await addColumnIfMissing(c, 'recurring_expenses', 'budget_amount', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'instructors', 'bank_branch_code', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'payment_type', "TEXT DEFAULT 'postpaid_bank'");
  await addColumnIfMissing(c, 'studios', 'bank_code', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'bank_branch_code', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'bank_name', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'bank_branch', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'bank_account_type', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'bank_account_number', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'bank_account_holder', 'TEXT');
  // 月の確定(凍結)時に master から自動実体化した instance かどうか (1=自動)。
  // 手動編集 (PATCH/休講) で 0 に落ちる。確定解除時は 1 のものだけ削除して master と再同期する。
  await addColumnIfMissing(c, 'lesson_instances', 'auto_materialized', 'INTEGER DEFAULT 0');
  // HACOMONO スケジュールマッピング: program行に持たせる実物準拠の既定属性
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'default_staff_code', 'TEXT');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'default_space_code', 'TEXT');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'trial_capacity', 'INTEGER');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'space_selectable', 'INTEGER');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'space_movable', 'INTEGER');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'publish_fixed', 'INTEGER');

  // Seed defaults if tables empty
  const scheduleCount = await c.execute('SELECT COUNT(*) as count FROM schedule');
  if (Number(scheduleCount.rows[0].count) === 0) {
    const items: [string, string, string, number][] = [
      ['', 'GRAFFITI ナンバー / Ryuki & TARO', 'No.1', 1],
      ['', 'フリースタイル / SAYUKI', 'No.2', 2],
      ['', 'HIPHOP / ちゃんなつ', 'No.3', 3],
      ['', 'NJS / おっちゃん', 'No.4', 4],
      ['', 'WAACK入門 / YURI', 'No.5', 5],
      ['', 'キッズ強化 / TARO', 'No.6', 6],
      ['', 'HOUSE エキスパート / K@TTSU', 'No.7', 7],
      ['', 'はじめてのHIPHOP / Ryuki', 'No.8', 8],
      ['', '日曜キッズHIPHOP / Ryuki', 'No.9', 9],
      ['', 'ベーシックダンスクラス / Ryuki & TARO', 'No.10', 10],
      ['', '多賀城 HIPHOP 入門 / AOI', 'No.11', 11],
      ['', '多賀城 HIPHOP 初級 / AOI', 'No.12', 12],
      ['', '多賀城 JAZZ / KEIKO', 'No.13', 13],
      ['', 'HIPHOP 中級 / TARO', 'No.14', 14],
      ['', 'HIPHOP 初級 / TARO', 'No.15', 15],
      ['', '水曜 HOUSE / K@TTSU', 'No.16', 16],
      ['', '七ヶ浜 HH 入門 / AOI', 'No.17', 17],
      ['', '七ヶ浜 HH 初級 / TARO', 'No.18', 18],
      ['', '多賀城 HOUSE / K@TTSU & AOI', 'No.19', 19],
      ['', '長町ガールズ合同 / KEIKO', 'No.20', 20],
      ['', '長町 KONAMI ちびっこ / TARO', 'No.21', 21],
      ['', '長町 KONAMI キッズ / TARO', 'No.22', 22],
      ['', '諏訪キッズ / HARUKA', 'No.23', 23],
    ];
    await c.batch(
      items.map(([time, title, description, sort_order]) => ({
        sql: 'INSERT INTO schedule (time, title, description, sort_order) VALUES (?, ?, ?, ?)',
        args: [time, title, description, sort_order],
      })),
      'write'
    );
  }

  const merchCount = await c.execute('SELECT COUNT(*) as count FROM merchandise');
  if (Number(merchCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['フェルトロゴキャップ ベージュ×グリーン', 4500, '/images/goods/cap_beige_green.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 1] },
      { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['フェルトロゴキャップ ベージュ', 4500, '/images/goods/cap_beige.png', 10, 'BOOM Dance School オリジナルフェルトロゴキャップ', 2] },
      { sql: 'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)', args: ['コーデュロイキャップ ブラック', 4500, '/images/goods/cap_black.png', 10, 'BOOM Dance School オリジナルコーデュロイキャップ', 3] },
    ], 'write');
  }

  const voteCount = await c.execute('SELECT COUNT(*) as count FROM vote_candidates');
  if (Number(voteCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ブーミー', 1] },
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ボンバー', 2] },
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ビーボ', 3] },
      { sql: 'INSERT INTO vote_candidates (name, votes, sort_order) VALUES (?, 0, ?)', args: ['ブースケ', 4] },
    ], 'write');
  }

  const snsCount = await c.execute('SELECT COUNT(*) as count FROM sns_links');
  if (Number(snsCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['youtube', 'https://www.youtube.com/@boom-sendai', 1] },
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['instagram', 'https://www.instagram.com/boom_sendai/', 2] },
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['line', 'https://lin.ee/example', 3] },
      { sql: 'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)', args: ['x', 'https://x.com/boom_sendai', 4] },
    ], 'write');
  }

  const settingsCount = await c.execute('SELECT COUNT(*) as count FROM settings');
  if (Number(settingsCount.rows[0].count) === 0) {
    await c.batch([
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['video_price', '2500'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['admin_password', 'boom2026'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['event_date', '2026-05-05'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['event_name', 'BOOM WOP vol.5'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['venue', '太白区文化センター 楽楽楽ホール'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['venue_address', '仙台市太白区長町5-3-2'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['paypay_link', ''] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['square_app_id', 'sandbox-sq0idb-PLACEHOLDER'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['square_location_id', 'PLACEHOLDER'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['video_sale_active', 'true'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['open_time', '13:45'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['start_time', '14:30'] },
      // Section visibility defaults (1=visible, 0=Coming Soon)
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_schedule_visible', '1'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_merch_visible', '1'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_video_visible', '0'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_music_visible', '0'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_vote_visible', '0'] },
      { sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', args: ['section_sns_visible', '1'] },
    ], 'write');
  }

  const perfCount = await c.execute('SELECT COUNT(*) as count FROM performances');
  if (Number(perfCount.rows[0].count) === 0) {
    // m_id, title, title_reading, instructor, instructor_photo_url, performer_count, genre, song_name, part
    const perfSql = 'INSERT INTO performances (m_id, title, title_reading, instructor, instructor_photo_url, performer_count, genre, song_name, part) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
    await c.batch([
      // --- Part 1 ---
      { sql: perfSql, args: ['M1',  'BOOMインストラクターナンバー', 'ブームインストラクターナンバー', 'ALL INSTRUCTORS', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M2',  'TARO HH 初級', 'タロー ヒップホップ しょきゅう', 'TARO', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M3',  'はじめてHH', 'はじめてヒップホップ', 'Ryuki', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M4',  'YURI WAACK', 'ユリ ワック', 'YURI', '', 0, 'WAACK', '', 1] },
      { sql: perfSql, args: ['M5',  '諏訪キッズ', 'すわキッズ', 'HARUKA', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M6',  '多賀城HOUSE', 'たがじょうハウス', 'K@TTSU & AOI', '', 0, 'HOUSE', '', 1] },
      { sql: perfSql, args: ['M7',  '長町キッズ', 'ながまちキッズ', 'TARO', '', 0, 'HIPHOP', '', 1] },
      { sql: perfSql, args: ['M8',  'ダンス部', 'ダンスぶ', '', '', 0, '', '', 1] },
      { sql: perfSql, args: ['M9',  'ZIEL ゲスト', 'ジール ゲスト', 'ZIEL', '', 0, '', '', 1] },
      { sql: perfSql, args: ['M10', 'おっちゃんNJS', 'おっちゃんエヌジェイエス', 'おっちゃん', '', 0, 'NJS', '', 1] },
      // --- Part 2 ---
      { sql: perfSql, args: ['M11', '多賀城HH入門', 'たがじょうヒップホップにゅうもん', 'AOI', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M12', 'ベーシックダンスクラス', 'ベーシックダンスクラス', 'Ryuki & TARO', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M13', '多賀城JAZZ', 'たがじょうジャズ', 'KEIKO', '', 0, 'JAZZ', '', 2] },
      { sql: perfSql, args: ['M14', '長町ちびっこ', 'ながまちちびっこ', 'TARO', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M15', '多賀城HH初級', 'たがじょうヒップホップしょきゅう', 'AOI', '', 0, 'HIPHOP', '', 2] },
      { sql: perfSql, args: ['M16', 'SAYUKIフリースタイル', 'サユキフリースタイル', 'SAYUKI', '', 0, 'FREESTYLE', '', 2] },
      { sql: perfSql, args: ['M17', 'TARO&TAKE', 'タローアンドタケ', 'TARO & TAKE', '', 0, '', '', 2] },
      { sql: perfSql, args: ['M18', 'K@TTSU HOUSE', 'カッツハウス', 'K@TTSU', '', 0, 'HOUSE', '', 2] },
      { sql: perfSql, args: ['M19', 'FOODIES', 'フーディーズ', '', '', 0, '', '', 2] },
      { sql: perfSql, args: ['M20', 'GRAFFITIナンバー', 'グラフィティナンバー', 'Ryuki & TARO', '', 0, 'HIPHOP', '', 2] },
      // --- Part 3 ---
      { sql: perfSql, args: ['M21', '七ヶ浜HH初級', 'しちがはまヒップホップしょきゅう', 'TARO', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M22', '長町ガールズ合同', 'ながまちガールズごうどう', 'KEIKO', '', 0, 'GIRLS', '', 3] },
      { sql: perfSql, args: ['M23', '日曜キッズHH', 'にちようキッズヒップホップ', 'Ryuki', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M24', 'ちゃんなつHH', 'ちゃんなつヒップホップ', 'ちゃんなつ', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M25', '七ヶ浜HH入門', 'しちがはまヒップホップにゅうもん', 'AOI', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M26', 'キッズ強化', 'キッズきょうか', 'TARO', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M27', 'クレアラシル', 'クレアラシル', '', '', 0, '', '', 3] },
      { sql: perfSql, args: ['M28', 'HOUSEエキスパート', 'ハウスエキスパート', 'K@TTSU', '', 0, 'HOUSE', '', 3] },
      { sql: perfSql, args: ['M29', 'NEW STYLERS', 'ニュースタイラーズ', '', '', 0, '', '', 3] },
      { sql: perfSql, args: ['M30', 'TARO HH中級', 'タローヒップホップちゅうきゅう', 'TARO', '', 0, 'HIPHOP', '', 3] },
      { sql: perfSql, args: ['M31', 'エンディングナンバー', 'エンディングナンバー', 'ALL', '', 0, '', '', 3] },
    ], 'write');
  }

  const musicCount = await c.execute('SELECT COUNT(*) as count FROM music_releases');
  if (Number(musicCount.rows[0].count) === 0) {
    await c.execute({
      sql: 'INSERT INTO music_releases (artist, title, jacket_url, apple_music_url, spotify_url, amazon_music_url, youtube_music_url, release_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: ['BOOM Dance School', 'Give Me A Reason', '/images/character/boomkun_2d.png', '', '', '', '', '2026-05-05T12:00:00', 1],
    });
  }

  // === HACOMONO スケジュールマッピング 初期seed (空の時のみ) ===
  // 実物HACOMONOエクスポートCSV (boom_studio_lesson_*.csv) を正として抽出した対応表。
  // HACOMONOでは「プログラム」がスタッフ/スペース/トライアル数/各フラグを規定するため、
  //   program行: BW5 class_name -> PGコード + 既定スタッフ/スペース/トライアル/フラグ
  //   staff行  : BW5 instructor名 -> INコード (BW5側で講師が確定する場合の優先解決用)
  //   space行  : 参照用 (出力スペースは原則 program 既定を使う)
  // 表記変更や新クラス追加時はこのテーブルを直接 (or 将来UIで) 編集する。
  // program: [bw5_key, code, name, staffCode, spaceCode, trial, selectable, movable, publishFixed]
  type HacoProg = [string, string, string, string, string, number, number, number, number];
  const hacoPrograms: HacoProg[] = [
    ['HIPHOP 中級', 'PG0001', 'TARO / HIPHOP 中級', 'IN0001', 'S0001_SP0001', 0, 0, 0, 1],
    ['HIPHOP 初級', 'PG0002', 'TARO / HIPHOP初級', 'IN0001', 'S0001_SP0001', 0, 0, 0, 1],
    ['K@TTSU HOUSE', 'PG0003', 'K@TTSU / HOUSE', 'IN0007', 'S0001_SP0001', 0, 0, 0, 1],
    ['七ヶ浜 HH 入門', 'PG0005', '七ヶ浜 HIPHOP 入門', 'IN0017', 'S0001_SP0008', 5, 0, 0, 1],
    ['七ヶ浜 HH 初級', 'PG0006', '七ヶ浜 HIPHOP 初級', 'IN0001', 'S0001_SP0008', 5, 0, 0, 1],
    ['長町 ガールズ 入門', 'PG0007', '長町 キッズガールズ 入門', 'IN0005', 'S0001_SP0007', 0, 0, 0, 1],
    ['はじめてのHH', 'PG0008', '初めてのヒップホップ', 'IN0018', 'S0001_SP0002', 0, 0, 0, 1],
    ['キッズHH', 'PG0009', 'KIDS HIPHOP', 'IN0018', 'S0001_SP0001', 0, 0, 0, 1],
    ['ベーシックダンスクラス', 'PG0010', 'ベーシックダンスクラス', 'IN0018', 'S0001_SP0001', 0, 0, 0, 1],
    ['多賀城 HH 入門', 'PG0011', '多賀城 HIPHOP基礎', 'IN0011', 'S0001_SP0001', 5, 0, 0, 1],
    ['多賀城 HH 初級', 'PG0012', '多賀城 HIPHOP初級', 'IN0011', 'S0001_SP0001', 5, 0, 0, 1],
    ['ちゃんなつ HH', 'PG0013', 'ちゃんなつ / HIPHOP', 'IN0002', 'S0001_SP0001', 0, 1, 1, 0],
    ['SAYUKI FS', 'PG0014', 'SAYUKI / FREE STYLE', 'IN0003', 'S0001_SP0001', 0, 1, 1, 0],
    ['おっちゃん NJS', 'PG0015', 'おっちゃん / NEW JACK SWING', 'IN0004', 'S0001_SP0001', 0, 1, 1, 0],
    ['キッズ 強化', 'PG0016', 'キッズ強化クラス', 'IN0001', 'S0001_SP0001', 0, 1, 1, 0],
    ['多賀城 HOUSE', 'PG0017', '多賀城 HOUSE', 'IN0007', 'S0001_SP0001', 0, 1, 1, 0],
    ['ダンス部', 'PG0018', 'ダンス部', 'IN0015', 'S0001_SP0001', 0, 0, 0, 1],
    ['多賀城 JAZZ', 'PG0019', '多賀城 STREET JAZZ', 'IN0005', 'S0001_SP0001', 5, 0, 0, 0],
    ['長町 WAACK 入門', 'PG0024', 'YURI / 長町 WAACK 入門', 'IN0010', 'S0001_SP0001', 0, 0, 0, 0],
    ['長町 ガールズ 初級', 'PG0027', '長町 キッズガールズ 初級', 'IN0005', 'S0001_SP0001', 0, 0, 0, 0],
    ['向山 ちびっこ HH', 'PG0028', '向山 キッズヒップホップ 基礎', 'IN0001', 'S0001_SP0001', 0, 0, 0, 0],
    ['HOUSE エキスパート', 'PG0040', 'HOUSE エキスパート (選抜のみ)', 'IN0007', 'S0001_SP0001', 0, 1, 1, 0],
  ];
  // staff: [bw5_key (BW5 instructor名), INコード, HACOMONO名]
  const hacoStaff: [string, string, string][] = [
    ['TARO', 'IN0001', 'TARO'],
    ['ちゃんなつ', 'IN0002', 'ちゃんなつ'],
    ['SAYUKI', 'IN0003', 'SAYUKI'],
    ['おっちゃん', 'IN0004', 'おっちゃん'],
    ['KEIKO', 'IN0005', 'KEIKO'],
    ['Ryuki', 'IN0006', 'Ryuki'],
    ['K@TTSU', 'IN0007', 'K@TTSU'],
    ['YURI', 'IN0010', 'YURI'],
    ['AOI', 'IN0011', 'AOI'],
    ['ダンス部', 'IN0015', 'ダンス部'],
  ];
  // space: 参照用 (出力は program 既定スペースを優先)。HACOMONO側は収容人数別。
  const hacoSpaces: [string, string, string][] = [
    ['S0001_SP0001', 'S0001_SP0001', '20名'],
    ['S0001_SP0002', 'S0001_SP0002', '15名'],
    ['S0001_SP0007', 'S0001_SP0007', '30名'],
    ['S0001_SP0008', 'S0001_SP0008', '40名'],
  ];

  // 新規行は INSERT OR IGNORE で投入し、program行の実物準拠属性は常に UPDATE で
  // 上書きする (旧seed済みの本番DBに新カラム値をバックフィルするため・冪等)。
  await c.batch(
    [
      ...hacoPrograms.map(([key, code, name, staffCode, spaceCode, trial, sel, mov, pub]) => ({
        sql: 'INSERT OR IGNORE INTO hacomono_schedule_map (entity_type, bw5_key, hacomono_code, hacomono_name, default_staff_code, default_space_code, trial_capacity, space_selectable, space_movable, publish_fixed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: ['program', key, code, name, staffCode, spaceCode, trial, sel, mov, pub] as (string | number)[],
      })),
      ...hacoStaff.map(([key, code, name]) => ({
        sql: 'INSERT OR IGNORE INTO hacomono_schedule_map (entity_type, bw5_key, hacomono_code, hacomono_name) VALUES (?, ?, ?, ?)',
        args: ['staff', key, code, name],
      })),
      ...hacoSpaces.map(([key, code, name]) => ({
        sql: 'INSERT OR IGNORE INTO hacomono_schedule_map (entity_type, bw5_key, hacomono_code, hacomono_name) VALUES (?, ?, ?, ?)',
        args: ['space', key, code, name],
      })),
      ...hacoPrograms.map(([key, code, name, staffCode, spaceCode, trial, sel, mov, pub]) => ({
        sql: `UPDATE hacomono_schedule_map
              SET hacomono_code = ?, hacomono_name = ?, default_staff_code = ?, default_space_code = ?,
                  trial_capacity = ?, space_selectable = ?, space_movable = ?, publish_fixed = ?,
                  updated_at = CURRENT_TIMESTAMP
              WHERE entity_type = 'program' AND bw5_key = ?`,
        args: [code, name, staffCode, spaceCode, trial, sel, mov, pub, key] as (string | number)[],
      })),
    ],
    'write'
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DBの結果は動的キーアクセス多用のため any を維持 */
export async function query(sql: string, args: any[] = []): Promise<ResultSet> {
  await initDb();
  return getClient().execute({ sql, args });
}

export async function execute(sql: string, args: any[] = []): Promise<ResultSet> {
  await initDb();
  return getClient().execute({ sql, args });
}

export async function getAll(sql: string, args: any[] = []): Promise<any[]> {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return result.rows as any[];
}

export async function getOne(sql: string, args: any[] = []): Promise<any | null> {
  await initDb();
  const result = await getClient().execute({ sql, args });
  return (result.rows[0] as any) || null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function batch(statements: InStatement[], mode: 'write' | 'read' | 'deferred' = 'write'): Promise<ResultSet[]> {
  await initDb();
  return getClient().batch(statements, mode);
}

async function addColumnIfMissing(c: Client, table: string, column: string, columnDef: string): Promise<void> {
  try {
    const result = await c.execute(`PRAGMA table_info(${table})`);
    const exists = result.rows.some(row => (row as Record<string, unknown>).name === column);
    if (!exists) {
      await c.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDef}`);
    }
  } catch {
    // テーブルが未作成の場合や、競合した場合は無視
  }
}
