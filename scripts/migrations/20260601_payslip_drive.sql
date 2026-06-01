-- scripts/migrations/20260601_payslip_drive.sql
ALTER TABLE payroll_runs ADD COLUMN drive_file_id TEXT;
ALTER TABLE payroll_runs ADD COLUMN payslip_uploaded_at TEXT;
