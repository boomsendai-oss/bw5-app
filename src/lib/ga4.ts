// GA4 Data API クライアント — LINEクリックKPI用 (Node.js runtime 専用)
//
// boom-sendai.com 上の LINEリンククリック (GA4カスタムイベント) を集計する。
//   - 総数        : eventName == GA4_LINE_EVENT の eventCount
//   - 広告経由    : 上記 + sessionSourceMedium == "google / cpc"
//
// 設定 (Vercel 環境変数):
//   GA4_PROPERTY_ID   例: 410842576
//   GA4_SA_KEY_JSON   サービスアカウントのJSONキー文字列まるごと
//   GA4_LINE_EVENT    イベント名 (省略時 line_click)。
//                     ※2026-06-24頃の新サイト移行で定義が変わる可能性があるためenv化
//
// 注意:
//   - GA4の集計は数時間〜1日遅れる。「速報値」とは謳わないこと
//   - 広告管理画面のコンバージョン数とは集計基準が違うため一致しない (GA4基準)
//   - 計測開始 2026-06-10 (それ以前のデータは存在しない)

import { BetaAnalyticsDataClient } from '@google-analytics/data';

export const GA4_MEASUREMENT_START = '2026-06-10'; // line_click 計測開始日
export const ADS_DAILY_BUDGET_JPY = 200; // スマートキャンペーン日予算 (CPA概算用)

export type LineClickStats = {
  available: boolean; // env未設定/権限エラー時 false
  error?: string;
  ranges: {
    days: number; // 7 | 30
    total: number; // LINEクリック総数
    ads: number; // うち google / cpc
  }[];
  fetchedAt: string;
};

function getClient(): { client: BetaAnalyticsDataClient; property: string } | null {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const keyJson = process.env.GA4_SA_KEY_JSON;
  if (!propertyId || !keyJson) return null;
  let creds: { client_email: string; private_key: string };
  try {
    creds = JSON.parse(keyJson);
  } catch {
    return null;
  }
  const client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
  });
  return { client, property: `properties/${propertyId}` };
}

const LINE_EVENT = () => process.env.GA4_LINE_EVENT || 'line_click';

// モジュールレベル簡易キャッシュ (1時間)。GA4自体が数時間遅れなのでこれで十分
let cache: { at: number; data: LineClickStats } | null = null;
const CACHE_MS = 60 * 60 * 1000;

export async function getLineClickStats(force = false): Promise<LineClickStats> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const cfg = getClient();
  if (!cfg) {
    return {
      available: false,
      error: 'GA4_PROPERTY_ID / GA4_SA_KEY_JSON が未設定です',
      ranges: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const dateRanges = [
    { startDate: '7daysAgo', endDate: 'today', name: 'd7' },
    { startDate: '30daysAgo', endDate: 'today', name: 'd30' },
  ];
  const eventFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: { value: LINE_EVENT() },
    },
  };

  try {
    // 総数と広告経由を1リクエスト(batch)で取得
    const [batch] = await cfg.client.batchRunReports({
      property: cfg.property,
      requests: [
        {
          dateRanges,
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: eventFilter,
        },
        {
          dateRanges,
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: {
            andGroup: {
              expressions: [
                eventFilter,
                {
                  filter: {
                    fieldName: 'sessionSourceMedium',
                    stringFilter: { value: 'google / cpc' },
                  },
                },
              ],
            },
          },
        },
      ],
    });

    // 複数dateRanges指定時、rowsに dateRange ディメンションが自動付与される
    const readRanges = (reportIdx: number): Record<string, number> => {
      const out: Record<string, number> = {};
      const rows = batch.reports?.[reportIdx]?.rows ?? [];
      for (const row of rows) {
        const rangeName = row.dimensionValues?.[0]?.value ?? '';
        out[rangeName] = Number(row.metricValues?.[0]?.value ?? 0);
      }
      return out;
    };
    const totals = readRanges(0);
    const ads = readRanges(1);

    const data: LineClickStats = {
      available: true,
      ranges: [
        { days: 7, total: totals['d7'] ?? 0, ads: ads['d7'] ?? 0 },
        { days: 30, total: totals['d30'] ?? 0, ads: ads['d30'] ?? 0 },
      ],
      fetchedAt: new Date().toISOString(),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { available: false, error: msg, ranges: [], fetchedAt: new Date().toISOString() };
  }
}

/** 'YYYY-MM' → GA4のdateRange。月末はうるう年も含めて正しく出す。 */
export function monthRange(ym: string): { startDate: string; endDate: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${ym}-01`, endDate: `${ym}-${String(last).padStart(2, '0')}` };
}

type AdRow = { metricValues?: ({ value?: string | null } | null)[] | null };

/** 日次行を合計する。cost は小数第2位で丸める(浮動小数の誤差を表示に持ち込まないため)。 */
export function sumAdRows(rows: AdRow[] | null | undefined): { cost: number; clicks: number } {
  let cost = 0;
  let clicks = 0;
  for (const r of rows ?? []) {
    cost += Number(r?.metricValues?.[0]?.value ?? 0);
    clicks += Number(r?.metricValues?.[1]?.value ?? 0);
  }
  return { cost: Math.round(cost * 100) / 100, clicks };
}

export type AdCost = {
  available: boolean;
  error?: string;
  /** GA4プロパティの通貨建て。2026-07-27時点でJPY化をTARO承認済み */
  cost: number;
  clicks: number;
};

/**
 * Google広告の費用とクリック数を取得する。
 *
 * ⚠️ advertiserAdCost は yearMonth 次元と互換性が無く、全月に同じ値を返してしまう
 * (本番で確認済み)。必ず date 次元で取得して合算すること。
 *
 * @param startDate 'YYYY-MM-DD' または '30daysAgo' 等のGA4表現
 */
export async function getAdCost(startDate: string, endDate: string): Promise<AdCost> {
  const cfg = getClient();
  if (!cfg) {
    return { available: false, error: 'GA4_PROPERTY_ID / GA4_SA_KEY_JSON が未設定です', cost: 0, clicks: 0 };
  }
  try {
    const [res] = await cfg.client.runReport({
      property: cfg.property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }],
      limit: 400,
    });
    const { cost, clicks } = sumAdRows(res.rows);
    return { available: true, cost, clicks };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), cost: 0, clicks: 0 };
  }
}
