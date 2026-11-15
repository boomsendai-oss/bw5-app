-- 体験予約「お友だち相乗り」案内メッセージのキュー(2026-11-15 TARO決定・業務ルール§7)。
-- 同じ友だちID×同じ枠に名字の違う申込者がいたら、予約した本人へ公式LINE登録案内を1回送る。
-- 重複防止は (lstep_id, reserved_at) の UNIQUE。送信は Mac常駐(M1)の daily_sync が Lステップ
-- 個別メッセージで行う。status: pending=検出済み未送信 / held=本番初回・秘書確認待ちで保留 /
-- sent=送信済み / skipped=送らない(本日分など) / failed=送信失敗。予約は取り消さない。
CREATE TABLE IF NOT EXISTS trial_friend_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lstep_id TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  lesson_name TEXT,
  applicants_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  detected_at TEXT NOT NULL,
  sent_at TEXT,
  note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_friend_invites_reserver_slot
  ON trial_friend_invites(lstep_id, reserved_at);

-- 本日(2026-11-15)のちゃんなつ枠(友だちID 278662425・鈴木琢/小山晴加)は送らない(TARO指示)。
-- 先にskippedで入れておけば、以降の取込の INSERT OR IGNORE では上書きされない。
INSERT OR IGNORE INTO trial_friend_invites (lstep_id, reserved_at, lesson_name, status, detected_at, note)
VALUES ('278662425', '2026-11-15 17:30:00', '(日) ちゃんなつ HIPHOP', 'skipped', '2026-11-15',
        '本日分・TARO指示で送らない(2026-11-15)');
