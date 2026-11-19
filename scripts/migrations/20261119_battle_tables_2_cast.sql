-- BOOM DOJO の出演者(ジャッジ・DJ・MC)を回ごとに持つ(TARO 2026-11-19)。
-- [{"role":"審判 JUDGE","name":"…","note":"…","instagram":"…","announced":false}]。announced=false の間は公開ページで「近日発表」。
ALTER TABLE battle_events ADD COLUMN cast_json TEXT NOT NULL DEFAULT '[]';
UPDATE battle_events SET cast_json = '[{"role":"審判 JUDGE","name":"YUWA","note":"HOUSE","instagram":"","announced":false},{"role":"DJ","name":"LEO","note":"","instagram":"","announced":false},{"role":"MC","name":"HARUKI","note":"","instagram":"","announced":false}]' WHERE event_key = '2026-12-26';
