-- BOOM DOJO: 受付番号を「No.001」(その回の中の連番)にする(TARO 2026-11-21「BT1226-001 は見づらい」)。
-- 確定した(paid/onsite)瞬間にその回の最大値+1を入れる。決済待ち・期限切れ・テストは番号なし(NULL)。
ALTER TABLE battle_entries ADD COLUMN receipt_seq INTEGER;
-- 既に確定している申込に、回ごとの id 順で番号をふる
UPDATE battle_entries SET receipt_seq = (
  SELECT COUNT(*) FROM battle_entries b
  WHERE b.event_key = battle_entries.event_key
    AND b.payment_status IN ('paid','onsite','canceled','refunded')
    AND b.id <= battle_entries.id
) WHERE payment_status IN ('paid','onsite','canceled','refunded');
