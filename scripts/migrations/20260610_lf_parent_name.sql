-- 保護者アカウントの親名管理
-- customer_kana: 体験予約CSV「お客さま」列由来のアカウント持ち主カナ(自動)
-- parent_name  : 運営が承認時に入力した親名(最優先で表示名に使う)
ALTER TABLE lstep_friends ADD COLUMN customer_kana TEXT;
ALTER TABLE lstep_friends ADD COLUMN parent_name TEXT;
