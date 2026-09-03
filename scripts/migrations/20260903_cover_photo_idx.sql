-- 発表会リールのカバーを「TAROが選んだ写真プールの中からKEIKOが選ぶ」ための列(TARO 2026-09-03)。
-- これまではClaudeがナンバー内の写真を各クリップへ機械的に割り当てていたが、
-- どのクリップにどの写真を使うかは現場(KEIKO)が選べた方がよい、という指示。
-- 値はプール(work/cover_pool_<Mnn>.json の items 添字)。NULL=未選択(従来どおりの割り当て)。
ALTER TABLE reel_draft ADD COLUMN cover_photo_idx INTEGER;
