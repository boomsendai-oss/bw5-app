-- 映像予約の確認メール送信履歴・支払いリンク送信履歴・支払い状況を追跡
ALTER TABLE video_preorders ADD COLUMN confirmation_email_sent_at TEXT;
ALTER TABLE video_preorders ADD COLUMN payment_link_sent_at TEXT;
ALTER TABLE video_preorders ADD COLUMN payment_paid_at TEXT;
