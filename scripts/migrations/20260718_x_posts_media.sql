-- X投稿の画像添付 (2026-07-18)
-- media: JSON配列 [{url, alt?}]。最大4枚・NULL=添付なし。
--   url は /api/upload が返す公開URL (本番=Vercel Blob / ローカル=/images/…)。
--   cron(/api/cron/x-autopost)が投稿時に url を fetch → X APIへアップロードし、
--   ツリーの1本目のツイートにだけ media_ids として添付する。
ALTER TABLE x_posts ADD COLUMN media TEXT;
