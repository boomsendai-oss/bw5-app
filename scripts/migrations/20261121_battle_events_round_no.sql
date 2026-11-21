-- BOOM DOJO: 受付番号を「BD01-001」(BD=BOOM DOJO・01=第何回・001=その回の確定順)にする(TARO 2026-11-21)。
-- 回の番号は列で持つ(タイトルの「其の一」から毎回読むと、コピーで作った回のタイトル直し忘れで番号がずれるため)。
-- 0=回の番号なし(テスト回など)。新しい回をコピーで作るときは元の回+1を入れる。
ALTER TABLE battle_events ADD COLUMN round_no INTEGER NOT NULL DEFAULT 0;
UPDATE battle_events SET round_no = CASE
  WHEN title LIKE '%其の十%' THEN 10
  WHEN title LIKE '%其の一%' THEN 1
  WHEN title LIKE '%其の二%' THEN 2
  WHEN title LIKE '%其の三%' THEN 3
  WHEN title LIKE '%其の四%' THEN 4
  WHEN title LIKE '%其の五%' THEN 5
  WHEN title LIKE '%其の六%' THEN 6
  WHEN title LIKE '%其の七%' THEN 7
  WHEN title LIKE '%其の八%' THEN 8
  WHEN title LIKE '%其の九%' THEN 9
  ELSE 0 END;
