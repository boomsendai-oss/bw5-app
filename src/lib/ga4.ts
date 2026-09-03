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

export type LineClickCount = {
  available: boolean;
  error?: string;
  /** 期間内のLINEクリック総数 */
  total: number;
  /** うち google / cpc 経由 */
  ads: number;
};

/**
 * 指定期間のLINEクリック数。getLineClickStats は 7日/30日 固定なので、
 * 月次ファネルのように任意期間で揃えたい場合はこちらを使う。
 * (ファネルの各段が違う期間だと1つのコホートとして誤読されるため)
 *
 * getLineClickStats と同じイベント名フィルタ・同じ 'google / cpc' フィルタを使う
 * (数字がずれないように)。月次で毎回呼ばれる想定のためキャッシュはしない
 * (既存の1時間キャッシュは7/30日固定範囲用でキーが無く、任意期間には使い回せない)。
 *
 * @param startDate 'YYYY-MM-DD'
 * @param endDate 'YYYY-MM-DD'
 */
export async function getLineClickCount(startDate: string, endDate: string): Promise<LineClickCount> {
  const cfg = getClient();
  if (!cfg) {
    return { available: false, error: 'GA4_PROPERTY_ID / GA4_SA_KEY_JSON が未設定です', total: 0, ads: 0 };
  }

  const eventFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: { value: LINE_EVENT() },
    },
  };

  try {
    const [batch] = await cfg.client.batchRunReports({
      property: cfg.property,
      requests: [
        {
          dateRanges: [{ startDate, endDate }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: eventFilter,
        },
        {
          dateRanges: [{ startDate, endDate }],
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

    // 単一dateRangeのみ指定しているため dateRange ディメンションは付与されない
    // (getLineClickStats と違い複数レンジを跨がないので、行は最大1件)。
    const sumRows = (reportIdx: number): number => {
      const rows = batch.reports?.[reportIdx]?.rows ?? [];
      let sum = 0;
      for (const row of rows) sum += Number(row.metricValues?.[0]?.value ?? 0);
      return sum;
    };

    return { available: true, total: sumRows(0), ads: sumRows(1) };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), total: 0, ads: 0 };
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
  /**
   * GA4プロパティに設定された通貨建ての値をそのまま返す(このコードは換算しない)。
   * 通貨コードは `currency` で報告されるので、呼び出し側は必ずそれと一緒に表示すること
   * (JPYだと決め打ちしてはいけない)。円で欲しい場合はGA4管理画面のプロパティ通貨をJPYにすること。
   */
  cost: number;
  clicks: number;
  /** GA4プロパティの通貨コード (例: 'JPY' | 'USD')。取得できない場合は ''。 */
  currency: string;
};

// 表示整形の実体は './adCostFormat' にある(このファイルは '@google-analytics/data' 経由で
// gRPC/Node専用コードをimportしており、クライアントコンポーネントから直接importすると
// ブラウザ向けビルドが壊れるため)。サーバ側の既存コードのために re-export だけしておく。
export { formatAdCost } from './adCostFormat';

/**
 * Google広告の費用とクリック数を取得する。
 *
 * ⚠️ advertiserAdCost には次元の相性がある(いずれも本番GA4で実測済み):
 *   - yearMonth 次元 … エラーにはならないが *全月に同じ値* を返す(壊れている)
 *   - date 次元のみ  … INVALID_ARGUMENT
 *     ("Please add sessionCampaignName to make the request compatible")
 *   - date + sessionCampaignName … ✅ 正しく日次×キャンペーンに分割される
 * よって sessionCampaignName を必ず併せて指定し、全行を合算する。
 * 表示にキャンペーン名は使わないが、この次元が無いとAPIが受け付けない。
 *
 * @param startDate 'YYYY-MM-DD' または '30daysAgo' 等のGA4表現
 */
export async function getAdCost(startDate: string, endDate: string): Promise<AdCost> {
  const cfg = getClient();
  if (!cfg) {
    return { available: false, error: 'GA4_PROPERTY_ID / GA4_SA_KEY_JSON が未設定です', cost: 0, clicks: 0, currency: '' };
  }
  try {
    const [res] = await cfg.client.runReport({
      property: cfg.property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: 'sessionCampaignName' }],
      metrics: [{ name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }],
      // 行数は 日数 × キャンペーン数。現在は1キャンペーンなので1ヶ月で最大31行。
      // ⚠️ 上限に達するとGA4はエラーを出さず黙って打ち切るため合計が過少になる。
      //    長期間やキャンペーン多数を集計したくなったらページングを実装すること。
      limit: 400,
    });
    const { cost, clicks } = sumAdRows(res.rows);
    const currency = res.metadata?.currencyCode ?? '';
    return { available: true, cost, clicks, currency };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), cost: 0, clicks: 0, currency: '' };
  }
}

// ── 流入チャネル (2026-09-01 月初レビューで自動化) ─────────────────────
// sessionDefaultChannelGroup = GA4標準のチャネル分類
// (Organic Search / Paid Search / Organic Social / Direct / Referral 等)。
// 「サイトに人がどこから来ているか」の週次観測用。
// ⚠️ GA4の集計は数時間〜1日遅れる。終端は「昨日」で呼ぶこと(当日分は固まらない)。

export type TrafficChannels = {
  available: boolean;
  error?: string;
  /** セッション数の多い順 */
  channels: { channel: string; sessions: number; users: number }[];
  total_sessions: number;
};

export async function getTrafficChannels(startDate: string, endDate: string): Promise<TrafficChannels> {
  const cfg = getClient();
  if (!cfg) {
    return { available: false, error: 'GA4_PROPERTY_ID / GA4_SA_KEY_JSON が未設定です', channels: [], total_sessions: 0 };
  }
  try {
    const [res] = await cfg.client.runReport({
      property: cfg.property,
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
      limit: 50, // チャネル分類は十数種しか無い
    });
    const channels = (res.rows ?? [])
      .map((r) => ({
        channel: r.dimensionValues?.[0]?.value || '(不明)',
        sessions: Number(r.metricValues?.[0]?.value ?? 0),
        users: Number(r.metricValues?.[1]?.value ?? 0),
      }))
      .sort((a, b) => b.sessions - a.sessions);
    return {
      available: true,
      channels,
      total_sessions: channels.reduce((a, c) => a + c.sessions, 0),
    };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), channels: [], total_sessions: 0 };
  }
}

// ── 流入チャネル別ファネル (2026-09-03・ディスプレイ広告の有効性判定用) ──
// 「チャネルごとに、来た人がどれだけ行動したか」。
// ディスプレイ広告を止めるかの判断は「セッション数」ではなく
// 「そのチャネルから来た人がLINEボタンを押したか(line_click)」で行う。
// エンゲージ率(engagedSessions/sessions)と平均滞在も並べ、無効クリック(即離脱)の疑いを見る。

export type ChannelFunnelRow = {
  channel: string;
  sessions: number;
  users: number;
  engaged_sessions: number;
  engagement_rate: number; // 0-1
  avg_session_sec: number;
  line_clicks: number;
  /** line_clicks / sessions (0-1)。分母0なら0 */
  line_click_rate: number;
};

export type ChannelFunnel = {
  available: boolean;
  error?: string;
  start: string;
  end: string;
  rows: ChannelFunnelRow[];
};

/** 純関数: 2本のレポート結果をチャネルで突合する(テスト対象) */
export function mergeChannelFunnel(
  base: { channel: string; sessions: number; users: number; engaged: number; avgSec: number }[],
  clicks: { channel: string; count: number }[]
): ChannelFunnelRow[] {
  const clickMap = new Map(clicks.map((c) => [c.channel, c.count]));
  return base
    .map((b) => {
      const lc = clickMap.get(b.channel) ?? 0;
      return {
        channel: b.channel,
        sessions: b.sessions,
        users: b.users,
        engaged_sessions: b.engaged,
        engagement_rate: b.sessions > 0 ? b.engaged / b.sessions : 0,
        avg_session_sec: b.avgSec,
        line_clicks: lc,
        line_click_rate: b.sessions > 0 ? lc / b.sessions : 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);
}

export async function getChannelFunnel(startDate: string, endDate: string): Promise<ChannelFunnel> {
  const cfg = getClient();
  if (!cfg) {
    return { available: false, error: 'GA4_PROPERTY_ID / GA4_SA_KEY_JSON が未設定です', start: startDate, end: endDate, rows: [] };
  }
  try {
    const [batch] = await cfg.client.batchRunReports({
      property: cfg.property,
      requests: [
        {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'engagedSessions' },
            { name: 'averageSessionDuration' },
          ],
          limit: 50,
        },
        {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: LINE_EVENT() } } },
          limit: 50,
        },
      ],
    });
    const r0 = batch.reports?.[0];
    const r1 = batch.reports?.[1];
    const base = (r0?.rows ?? []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || '(不明)',
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
      users: Number(r.metricValues?.[1]?.value ?? 0),
      engaged: Number(r.metricValues?.[2]?.value ?? 0),
      avgSec: Number(r.metricValues?.[3]?.value ?? 0),
    }));
    const clicks = (r1?.rows ?? []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || '(不明)',
      count: Number(r.metricValues?.[0]?.value ?? 0),
    }));
    return { available: true, start: startDate, end: endDate, rows: mergeChannelFunnel(base, clicks) };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e), start: startDate, end: endDate, rows: [] };
  }
}
