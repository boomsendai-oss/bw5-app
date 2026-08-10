-- リールのInstagram共同投稿(collaborators)。
-- 投稿時に相手へ招待が飛び、承認されると相手のフィードにも並ぶ(最大3人・非公開アカウント不可)。
-- 値はスペース/カンマ区切りのInstagramユーザー名。空/NULL = 共同投稿なし。
-- draft側はTAROが投稿待ちカードで選ぶ値、queue側は予約時にコピーされる実投稿値。
ALTER TABLE reel_draft ADD COLUMN collaborators TEXT;
ALTER TABLE reel_queue ADD COLUMN collaborators TEXT;
