-- 20260607_string_fk_to_id.sql
-- 文字列ベースの外部キーをID参照に移行
-- 旧カラムは残す（SQLiteはDROP COLUMNの制約あり＆アプリ移行完了まで互換性維持）

-- ============================================================
-- 1. payroll_lines.studio_name → studio_id
-- ============================================================
ALTER TABLE payroll_lines ADD COLUMN studio_id INTEGER;

UPDATE payroll_lines SET studio_id = (
  SELECT id FROM studios WHERE studios.name = payroll_lines.studio_name
) WHERE studio_name IS NOT NULL;

-- ============================================================
-- 2. payroll_lines.class_name → lesson_master_id
--    class_name は略称で保存されている行がある (例: "はじめてのHH" → lesson_master "はじめてのHIPHOP")
--    まず完全一致、次に略称マッピングで埋める
-- ============================================================
ALTER TABLE payroll_lines ADD COLUMN lesson_master_id INTEGER;

-- 2a. 完全一致
UPDATE payroll_lines SET lesson_master_id = (
  SELECT id FROM lesson_master WHERE lesson_master.class_name = payroll_lines.class_name
) WHERE class_name IS NOT NULL AND lesson_master_id IS NULL;

-- 2b. 略称 → 正式名マッピング
UPDATE payroll_lines SET lesson_master_id = 1  WHERE class_name = 'はじめてのHH' AND lesson_master_id IS NULL;
UPDATE payroll_lines SET lesson_master_id = 2  WHERE class_name = 'キッズHH' AND lesson_master_id IS NULL;
UPDATE payroll_lines SET lesson_master_id = 4  WHERE class_name = '多賀城 HH 入門' AND lesson_master_id IS NULL;
UPDATE payroll_lines SET lesson_master_id = 5  WHERE class_name = '多賀城 HH 初級' AND lesson_master_id IS NULL;
UPDATE payroll_lines SET lesson_master_id = 6  WHERE class_name = 'ちゃんなつ HH' AND lesson_master_id IS NULL;
UPDATE payroll_lines SET lesson_master_id = 7  WHERE class_name = 'おっちゃん NJS' AND lesson_master_id IS NULL;
UPDATE payroll_lines SET lesson_master_id = 8  WHERE class_name = 'SAYUKI FS' AND lesson_master_id IS NULL;

-- ============================================================
-- 3. studio_billing_lines.class_name → lesson_master_id
--    合成ラベル（バッファ・区分）は lesson_master_id = NULL のまま残す
-- ============================================================
ALTER TABLE studio_billing_lines ADD COLUMN lesson_master_id INTEGER;

-- 3a. 完全一致
UPDATE studio_billing_lines SET lesson_master_id = (
  SELECT id FROM lesson_master WHERE lesson_master.class_name = studio_billing_lines.class_name
) WHERE class_name IS NOT NULL AND lesson_master_id IS NULL;

-- 3b. 略称 → 正式名マッピング
UPDATE studio_billing_lines SET lesson_master_id = 1  WHERE class_name = 'はじめてのHH' AND lesson_master_id IS NULL;
UPDATE studio_billing_lines SET lesson_master_id = 2  WHERE class_name = 'キッズHH' AND lesson_master_id IS NULL;
UPDATE studio_billing_lines SET lesson_master_id = 4  WHERE class_name = '多賀城 HH 入門' AND lesson_master_id IS NULL;
UPDATE studio_billing_lines SET lesson_master_id = 5  WHERE class_name = '多賀城 HH 初級' AND lesson_master_id IS NULL;
UPDATE studio_billing_lines SET lesson_master_id = 6  WHERE class_name = 'ちゃんなつ HH' AND lesson_master_id IS NULL;
UPDATE studio_billing_lines SET lesson_master_id = 7  WHERE class_name = 'おっちゃん NJS' AND lesson_master_id IS NULL;
UPDATE studio_billing_lines SET lesson_master_id = 8  WHERE class_name = 'SAYUKI FS' AND lesson_master_id IS NULL;
-- 合成ラベル ([午前区分], [夜間], （準備・バッファ 30分）) は lesson_master_id = NULL のまま

-- ============================================================
-- 4. hacomono_billing_records.member_id → boom_member_id
--    member_id は hacomono の会員ID（文字列）。boom_members.hacomono_member_id と照合して
--    boom_members.id を参照する新カラムを追加。
-- ============================================================
ALTER TABLE hacomono_billing_records ADD COLUMN boom_member_id INTEGER;

UPDATE hacomono_billing_records SET boom_member_id = (
  SELECT id FROM boom_members WHERE boom_members.hacomono_member_id = hacomono_billing_records.member_id
) WHERE member_id IS NOT NULL;
