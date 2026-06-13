-- 会員ルールv1: チケット会員の自動退会 進行管理 + お帰りクーポン記録
-- 退会の「実行」はHACOMONO上で人手(不可逆操作)。アプリは候補抽出・事前通知・
-- 記録までを担い、最終の退会クリックはスタッフが行う(human-in-the-loop)。
-- 詳細: boom-events-hub/docs/decisions/2026-06-14_membership-rules-v1-impl.md

CREATE TABLE IF NOT EXISTS withdrawal_notices (
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
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_notices_status ON withdrawal_notices(status);

CREATE TABLE IF NOT EXISTS homecoming_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  trigger TEXT NOT NULL,              -- auto_withdrawal / self_withdrawal
  coupon_label TEXT DEFAULT '入会金半額(2,000円)・永年',
  issued_at TEXT DEFAULT CURRENT_TIMESTAMP,
  delivered_channel TEXT,             -- line / email
  redeemed_at TEXT,                   -- 再入会で使われた日 (任意)
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_homecoming_coupons_member ON homecoming_coupons(member_id);
