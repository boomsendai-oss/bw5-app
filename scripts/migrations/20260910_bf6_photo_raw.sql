-- BF6 顔写真の元画像(切り抜き前)置き場(2026-09-10)
--
-- スマホ内の切り抜き(MediaPipe)はLEDの大画面に耐えないため、会場のMacBook Airに
-- 「切り抜き係」(rembg)を常駐させ、元画像から高品質に抜き直して bf_photo を差し替える。
-- スマホは今までどおり撮って送るだけ。Macが落ちていても仮の切り抜きが bf_photo に残る。
CREATE TABLE IF NOT EXISTS bf_photo_raw (
  item_id    INTEGER PRIMARY KEY,
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  created_at TEXT NOT NULL,
  cut_at     TEXT,            -- Macが抜き直して bf_photo を差し替えた時刻(NULL=未処理)
  cut_model  TEXT             -- 使ったモデル名(検証用)
);
