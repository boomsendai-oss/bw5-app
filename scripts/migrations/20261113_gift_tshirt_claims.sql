-- 入会特典Tシャツの台帳(2026-11-13)。設計: boom-events-hub docs/superpowers/specs/2026-11-13-gift-tshirt-automation-design.md §2・§7-3
-- 1会員1枚。該当の判定は src/lib/giftTshirt.ts(請求記録 hacomono_billing_records の入会時の請求)。
-- 名前は持たない(boom_members.id で引く)。日付は JST の YYYY-MM-DD。
--   status: invite_pending(未案内) → invited(案内済) → answered(回答済=色とサイズあり)
--           → ordered(発注済) → received(届いた=印刷待ち) → printed(お渡し待ち) → handed(お渡し済み)
--           no_line(LINE未紐付けで案内できない=秘書のまとめへ) / skipped(対象外にした)
CREATE TABLE IF NOT EXISTS gift_tshirt_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boom_member_id INTEGER NOT NULL UNIQUE,
  billing_record_id INTEGER,
  enrolled_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invite_pending',
  line_linked INTEGER NOT NULL DEFAULT 0,
  invited_on TEXT,
  reminded_on TEXT,
  answered_at TEXT,
  color TEXT,
  size TEXT,
  ordered_on TEXT,
  received_on TEXT,
  printed_on TEXT,
  handed_on TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gift_tshirt_claims_status ON gift_tshirt_claims(status);
