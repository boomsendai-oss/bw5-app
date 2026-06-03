-- HACOMONO側でクラスの「適用終了年月」を設定済みかを記録するフラグ。
-- アプリ上で終了/無効になったクラスは、HACOMONOでは終了月を設定しないと枠が無限生成される。
-- このフラグ=1 なら「HACOMONO側も終了設定済み」とみなし、調整リストの幻枠警告から除外する。
ALTER TABLE hacomono_schedule_map ADD COLUMN hacomono_closed INTEGER DEFAULT 0;
