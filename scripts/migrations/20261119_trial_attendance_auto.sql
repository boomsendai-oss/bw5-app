-- 体験予約の「来た／来なかった」の自動判定を持つ列（2026-11-19・TAROの方針「入会率を来た人のうちで出す」）。
-- 書くのは M1 の scripts/trial_followup（boom-events-hub）。status 列は Lステップの取込で上書きされるため別の列にする。
-- attendance_auto: attended（来た）/ noshow（連絡なしで来なかった）/ unsure（判断できない）/ self_cancel（本人が取消）
-- Lステップでスタッフが「来店確認済」にした予約は attended にそろえて書く。人の訂正は従来どおり attendance_override。
-- 非破壊：列を足すだけ。
ALTER TABLE trial_records ADD COLUMN attendance_auto TEXT;
ALTER TABLE trial_records ADD COLUMN attendance_auto_why TEXT;
ALTER TABLE trial_records ADD COLUMN attendance_auto_at TEXT;
