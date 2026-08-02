-- SEO順位トラッキング (2026-08-02)
--
-- 背景: 「順位が上がった気がする」を検証する手段が無かった。
-- 2026-07-14に手動で実測したベースライン(スクショ22枚)があるが、記録がSTATE.mdの散文だけで
-- 比較に使えない。数値として持ち、推移が見える状態にする。
--
-- 3つのソースを1つのテーブルに集める:
--   manual : 人がシークレットモードで検索して数えた順位(2026-07-14のベースライン等)
--   gsc    : Search Console API の平均掲載順位(移管完了後に有効)
--   gbp    : GBPのパフォーマンス指標は数値の種類が違うので別テーブル

CREATE TABLE IF NOT EXISTS seo_rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  measured_on TEXT NOT NULL,          -- YYYY-MM-DD (JST)
  source TEXT NOT NULL,               -- 'manual' | 'gsc'
  query TEXT NOT NULL,                -- 検索キーワード
  target TEXT NOT NULL DEFAULT 'hp',  -- 'hp' | 'instagram' | 'map' — 何の順位か
  position REAL,                      -- 順位。圏外は NULL にして out_of_range=1
  out_of_range INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER,                -- gscのみ
  clicks INTEGER,                     -- gscのみ
  page TEXT,                          -- gscのみ: どのURLが出たか
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- 同じ日・同じソース・同じクエリ・同じ対象は1行だけ(再実行で増殖させない)
  UNIQUE(measured_on, source, query, target)
);

CREATE INDEX IF NOT EXISTS idx_seo_rank_query ON seo_rank_snapshots(query, measured_on);

-- GBPのパフォーマンス(マップパック側の効果測定)
-- 表示回数・ウェブサイトクリック・経路リクエストなど。順位そのものは取れないが、
-- 「地図で何回見られたか」が分かるので、マップパック施策の効果はこちらで測る。
CREATE TABLE IF NOT EXISTS gbp_performance_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_date TEXT NOT NULL,          -- YYYY-MM-DD
  metric TEXT NOT NULL,               -- BUSINESS_IMPRESSIONS_MOBILE_MAPS 等
  value INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(metric_date, metric)
);

CREATE INDEX IF NOT EXISTS idx_gbp_perf_date ON gbp_performance_daily(metric_date);
