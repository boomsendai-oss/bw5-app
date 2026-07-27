import type { InStatement } from '@libsql/client';

/**
 * All CREATE TABLE / CREATE INDEX statements for the BOOMapp database.
 * Called once from initDb() in db.ts.
 */
export function getSchemaStatements(): InStatement[] {
  return [
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
      unit_price INTEGER,
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
      member_type TEXT DEFAULT 'regular',
      -- 契約プラン情報 (sync/route.ts が ML010 契約中CSVから取り込む。T-171: 本番legacy ALTERと正本を一致させる)
      plan_code TEXT,
      plan_name TEXT,
      plan_started_at TEXT,
      plan_continued_months TEXT,
      -- 保護者/代表者情報 (子供会員の家族突合・代表者判定に使用)
      guardian_relation TEXT,
      rep_name TEXT,
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
      // === 会員ルールv1: チケット会員 自動退会の進行管理 ===
      // 退会の「実行」はHACOMONO上で人手(不可逆操作)。本テーブルは候補→事前通知→
      // 退会処理 の各段階を記録し、二重通知・取りこぼしを防ぐ監査用バックボーン。
      sql: `CREATE TABLE IF NOT EXISTS withdrawal_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      reason TEXT NOT NULL,               -- inactive_6mo / never_attended_3mo / long_dormant_nodata
      last_checkin_date TEXT,             -- 判定時点の最終チェックイン (なければNULL)
      checkin_count INTEGER DEFAULT 0,
      notified_at TEXT,                   -- 退会1ヶ月前の事前通知を送った日時 (未送信ならNULL)
      notice_channel TEXT,                -- line / email / both
      extended_until TEXT,                -- スタッフが延長した場合の再判定日 (タイマーリセット)
      withdrawn_at TEXT,                  -- 実際にHACOMONOで退会処理した日 (人手記録)
      status TEXT DEFAULT 'candidate',    -- candidate / notified / extended / withdrawn / reactivated
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(member_id)
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_withdrawal_notices_status ON withdrawal_notices(status)`, args: [] },
    {
      // === 会員ルールv1: お帰りクーポン(入会金半額2,000円・永年) 付与記録 ===
      // 自動退会・自主退会の両方で付与。再入会時の本人確認・重複防止に使う。
      sql: `CREATE TABLE IF NOT EXISTS homecoming_coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      trigger TEXT NOT NULL,              -- auto_withdrawal / self_withdrawal
      coupon_label TEXT DEFAULT '入会金半額(2,000円)・永年',
      issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
      delivered_channel TEXT,             -- line / email
      redeemed_at TEXT,                   -- 再入会で使われた日 (任意)
      note TEXT
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_homecoming_coupons_member ON homecoming_coupons(member_id)`, args: [] },
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
      enrolled_member_id INTEGER,                 -- 突合できた boom_members.id (FKは張らない。既存の member_id 列に合わせる)
      matched_by TEXT,                            -- 突合根拠: kana_auto / lstep_link / manual
      matched_at TEXT,                            -- 突合時刻 (UTC ISO)
      attendance_override TEXT,                   -- 来店判定の人手訂正: 'noshow' のみ。未訂正は NULL
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
      boom_member_id INTEGER,
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
      studio_id INTEGER,
      lesson_master_id INTEGER,
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
      lesson_master_id INTEGER,
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

    { sql: `CREATE TABLE IF NOT EXISTS admin_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    )`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_admin_sess_token ON admin_sessions(token)`, args: [] },

    // PR-5: レート制限の固定窓カウンタ (本番は台帳 20260720_rate_limits.sql で作成済み)
    { sql: `CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL
    )`, args: [] },

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
      // === 月の確定/凍結 (Phase2) ===
      sql: `CREATE TABLE IF NOT EXISTS month_confirmations (
      year_month TEXT PRIMARY KEY,
      confirmed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      materialized_count INTEGER DEFAULT 0,
      note TEXT
    )`,
      args: [],
    },
    {
      // === スタッフ通知 ===
      sql: `CREATE TABLE IF NOT EXISTS staff_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      severity TEXT DEFAULT 'info',
      related_member_id INTEGER,
      related_lstep_id TEXT,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_staff_notif_ack ON staff_notifications(acknowledged_at)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_staff_notif_type ON staff_notifications(type)`, args: [] },
    { sql: `CREATE INDEX IF NOT EXISTS idx_staff_notif_created ON staff_notifications(created_at)`, args: [] },

    {
      // === WS O: FAQ AIチャットボット「BOOMくんに質問」の正本テーブル ===
      // HP FAQ・料金・入会情報の一元管理。is_public=1 のみ公開抽出(/api/public/knowledge)へ流れる
      sql: `CREATE TABLE IF NOT EXISTS faq_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
      args: [],
    },
    { sql: `CREATE INDEX IF NOT EXISTS idx_faq_entries_public ON faq_entries(is_public, category, sort_order)`, args: [] },

    {
      // === WS O: スタジオ (/api/public/knowledge が studios を読むためローカルにも定義) ===
      // 本番では scripts/migrations/20260518_master_data_schedule.sql 由来のテーブルに
      // is_public/access_text/map_embed_url 列が既に存在する(boom-hpが本番でWHERE active=1 AND
      // is_public=1として使用中)が、その3列はリポジトリのマイグレーション台帳には未反映。
      // 本番は列既存のため台帳SQLは追加せず、ローカルinitDb()経路のみで揃える。
      sql: `CREATE TABLE IF NOT EXISTS studios (
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
      is_public INTEGER DEFAULT 0,
      access_text TEXT,
      map_embed_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },

    {
      // === WS O: インストラクター (/api/public/knowledge が instructors を読むためローカルにも定義) ===
      // 本番では scripts/migrations/20260518_master_data_schedule.sql 由来のテーブルに
      // slug/genre/crews/career_text/video_url/public_display_order 列が既に存在する
      // (boom-hpが本番でSELECT対象として使用中・WHERE active=1 AND slug IS NOT NULL AND slug!=''で絞込)が、
      // その6列はリポジトリのマイグレーション台帳には未反映。
      // 本番は列既存のため台帳SQLは追加せず、ローカルinitDb()経路のみで揃える(studiosと同じ思想)。
      // ※ id/name/name_kana〜notes/active/created_at/updated_at は台帳(20260518_master_data_schedule.sql)と同一。
      sql: `CREATE TABLE IF NOT EXISTS instructors (
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
      slug TEXT,
      genre TEXT,
      crews TEXT,
      career_text TEXT,
      video_url TEXT,
      public_display_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },

    {
      // === WS O: レッスンマスター (/api/public/knowledge が lesson_master を読むためローカルにも定義) ===
      // 本番では scripts/migrations/20260518_master_data_schedule.sql 由来のテーブルに
      // slug/description_text/is_public/video_url 列が既に存在する
      // (boom-hpが本番でWHERE active=1 AND is_public=1として使用中)が、その4列はリポジトリのマイグレーション台帳には未反映。
      // 本番は列既存のため台帳SQLは追加せず、ローカルinitDb()経路のみで揃える(studiosと同じ思想)。
      // ※ id〜notes/created_at/updated_at は台帳(20260518_master_data_schedule.sql)と同一
      //   (start_date/end_dateは20260603_lesson_master_date_range.sqlで追加済みだが本機能では未使用のためここでは省略)。
      sql: `CREATE TABLE IF NOT EXISTS lesson_master (
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
      slug TEXT,
      description_text TEXT,
      is_public INTEGER DEFAULT 0,
      video_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      edit_token TEXT NOT NULL UNIQUE,
      understood INTEGER NOT NULL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_event_signups_event ON event_signups (event_id)`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signup_performers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signup_id INTEGER NOT NULL,
      performer_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_signup_performers_signup ON event_signup_performers (signup_id)`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signup_parts (
      performer_id INTEGER NOT NULL,
      part_key TEXT NOT NULL,
      PRIMARY KEY (performer_id, part_key)
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signup_settings (
      event_id INTEGER PRIMARY KEY,
      parts_json TEXT NOT NULL DEFAULT '[]',
      fee_text TEXT NOT NULL DEFAULT '',
      deadline TEXT DEFAULT '',
      intro_md TEXT NOT NULL DEFAULT '',
      calendar_url TEXT DEFAULT '',
      is_open INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT '',
      share_token TEXT
    )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS event_signup_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      signup_id INTEGER,
      actor TEXT NOT NULL DEFAULT 'guest',
      action TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_event_signup_audit_event ON event_signup_audit (event_id)`,
      args: [],
    },
  ];
}
