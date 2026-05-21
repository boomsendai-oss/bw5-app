-- 月次運用レポート (自動生成) 保存テーブル
-- POST /api/staff/operations/monthly-report で UPSERT される
CREATE TABLE IF NOT EXISTS monthly_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month TEXT UNIQUE NOT NULL,            -- "2026-05"
  report_markdown TEXT NOT NULL,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
