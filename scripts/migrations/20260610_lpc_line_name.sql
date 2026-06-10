-- 承認待ち変更にLINEアカウント名(LINE登録名)を持たせる
-- 「どのLINEアカウントの表示名を変えるのか」を承認画面で見せるため
ALTER TABLE lstep_pending_changes ADD COLUMN line_name TEXT;
