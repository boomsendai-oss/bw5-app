-- T-157/T-160: 体験→入会ファネルの土台。
-- boom_members は「契約中(プラン契約者)」しか取り込まないため、
-- 「会員登録だけ(プラン未契約)＝体験に来たが未入会」の層が見えない。
-- HACOMONO ML001(全メンバー)を別テーブルに取り込み、来店・入会・未契約を把握する。
-- PII最小化: 氏名/カナ/代表氏名は重複検出に必要なため保持。メアド/住所/電話は取り込まない(has_emailフラグのみ)。
-- スナップショット方式: 毎回の取込で全件洗い替え(DELETE→INSERT)。

CREATE TABLE IF NOT EXISTS hacomono_all_members (
  hacomono_member_id TEXT PRIMARY KEY,   -- メンバーID
  kaiin_no TEXT,                          -- 会員番号
  full_name TEXT,                         -- 氏名
  full_name_kana TEXT,                    -- 氏名カナ
  has_email INTEGER DEFAULT 0,            -- メアド有無(1/0)
  permission_type TEXT,                   -- 権限タイプ(代表アカウント/その他メンバー/空)
  rep_name TEXT,                          -- 代表氏名(保護者名義の誤登録検出に使用)
  trial_received_at TEXT,                 -- 無料体験会受講日時(BOOMは未使用=空が普通)
  enrolled_at TEXT,                       -- 入会日時(=メンバー作成日≒体験来店日)
  last_lesson_at TEXT,                    -- 最終受講日時
  plan_code TEXT,                         -- 契約プランコード(空=未契約)
  plan_name TEXT,                         -- 契約プラン名
  plan_started_at TEXT,                   -- プラン契約日
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_all_members_plan ON hacomono_all_members(plan_code);
CREATE INDEX IF NOT EXISTS idx_all_members_kana ON hacomono_all_members(full_name_kana);
