-- クチコミ声がけリスト: 家族(保護者)単位の依頼進捗トラッキング
-- family_key = 家族グループ内の boom_members.id 最小値(全status対象で算出し安定化)
CREATE TABLE IF NOT EXISTS review_outreach (
  family_key INTEGER PRIMARY KEY,
  asked_at TEXT,
  posted_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
