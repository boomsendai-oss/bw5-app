import type { Client } from '@libsql/client';

/**
 * Idempotent column migrations — adds columns to existing tables if missing.
 * Called once from initDb() in db.ts after schema creation.
 */
export async function runMigrations(c: Client): Promise<void> {
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
  // 【既知の乖離】studiosのis_public/access_text/map_embed_urlは本番DBに手動追加済みだが
  // マイグレーション台帳(scripts/migrations/)には存在しない(素のALTERを足すと本番で列重複エラーになるため)。
  // 台帳のみから新規DBを作る場合はこのinitDb経路(冪等)を必ず一度通すこと。
  await addColumnIfMissing(c, 'studios', 'is_public', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(c, 'studios', 'access_text', 'TEXT');
  await addColumnIfMissing(c, 'studios', 'map_embed_url', 'TEXT');
  // 月の確定(凍結)時に master から自動実体化した instance かどうか (1=自動)。
  await addColumnIfMissing(c, 'lesson_instances', 'auto_materialized', 'INTEGER DEFAULT 0');
  // HACOMONO スケジュールマッピング: program行に持たせる実物準拠の既定属性
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'default_staff_code', 'TEXT');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'default_space_code', 'TEXT');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'trial_capacity', 'INTEGER');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'space_selectable', 'INTEGER');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'space_movable', 'INTEGER');
  await addColumnIfMissing(c, 'hacomono_schedule_map', 'publish_fixed', 'INTEGER');
  // 体験予約 担当周知(WS T / 2026-07-18)の trial_records 列(course_type/dance_experience/
  // referral_source)は台帳 scripts/migrations/20260718_trial_notify_fields.sql で追加する。
  // 本番は SKIP_DB_INIT=1 でこの runMigrations 自体が走らないため、ここに書いても本番へ届かない。
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
