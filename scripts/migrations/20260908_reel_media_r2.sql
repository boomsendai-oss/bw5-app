-- リール素材の置き場を Vercel public/ から Cloudflare R2 (https://media.boom-sendai.com) へ移行 (2026-09-08)
-- 相対パス(/reels/... /reel-drafts/...)を R2 の絶対URLへ書き換える。既に http のものは触らない
UPDATE reel_queue SET video_path = 'https://media.boom-sendai.com' || video_path WHERE video_path LIKE '/reels/%';
UPDATE reel_queue SET cover_path = 'https://media.boom-sendai.com' || cover_path WHERE cover_path LIKE '/reels/%';
UPDATE reel_draft SET reel_path = 'https://media.boom-sendai.com' || reel_path WHERE reel_path LIKE '/reels/%';
UPDATE reel_draft SET cover_path = 'https://media.boom-sendai.com' || cover_path WHERE cover_path LIKE '/reels/%';
UPDATE reel_draft SET preview_path = 'https://media.boom-sendai.com' || preview_path WHERE preview_path LIKE '/reel-drafts/%';
UPDATE reel_draft SET cover_candidates = REPLACE(cover_candidates, '"url":"/reel-drafts/', '"url":"https://media.boom-sendai.com/reel-drafts/') WHERE cover_candidates LIKE '%"url":"/reel-drafts/%';
