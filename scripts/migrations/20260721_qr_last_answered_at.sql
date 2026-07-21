-- 固定QR再送対応(WS U / 2026-07-21)
-- アンケート再回答(restriction_type=MULTIPLE)による再送を可能にするため、
-- 最後に処理したアンケート回答日時を会員ごとに記録する列を追加する。
-- これより新しい回答が来たら「再申請」とみなして既存QRを再送する。

ALTER TABLE member_qr_issues ADD COLUMN last_answered_at TEXT;
