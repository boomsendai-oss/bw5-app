-- LINE紐付け強化: 体験予約データ(友だちID + 子のフルネーム)を突合キーにする
--
-- 背景:
--   Lstep友だちCSVは「登録ID・表示名(ニックネーム)」しか持たず本名が無いため、
--   会員(HACOMONO)との自動突合が機能していなかった。
--   一方、体験予約CSVには「友だちID」と「お名前/お名前(カナ)/ご年齢」が同一行に
--   存在する。体験を受けないと入会できない運用のため、全会員が必ず体験を通過する。
--   → 体験予約のカナ名と会員のカナ名を突合すれば、友だちID(=LINEアカウント)を
--     会員に高精度で紐付けられる。
--
-- LINE種別判定(本人/保護者/要確認)の材料:
--   - boom_members.birthday から年齢算出 (≤12=保護者, ≥18=本人, 13-17=要確認)
--   - 緊急連絡先続柄(母/父等) → 保護者確定
--   - 代表氏名が会員氏名と別人 → 保護者の存在
--   - 1つの友だちIDに複数会員(兄弟) → 保護者確定

-- 体験予約: 突合キーとなる申込者名・カナ・年齢を保持
ALTER TABLE trial_records ADD COLUMN applicant_name TEXT;
ALTER TABLE trial_records ADD COLUMN applicant_name_kana TEXT;
ALTER TABLE trial_records ADD COLUMN applicant_age INTEGER;

-- 会員: LINE種別判定に使う続柄・代表氏名
ALTER TABLE boom_members ADD COLUMN guardian_relation TEXT; -- 緊急連絡先続柄 (母/父等)
ALTER TABLE boom_members ADD COLUMN rep_name TEXT;          -- 代表氏名 (保護者名)

-- カナ突合を高速化
CREATE INDEX IF NOT EXISTS idx_trial_applicant_kana ON trial_records(applicant_name_kana);
