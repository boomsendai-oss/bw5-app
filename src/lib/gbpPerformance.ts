// src/lib/gbpPerformance.ts — Node.js runtime 専用。
//
// GBPのパフォーマンス指標(マップ/検索での表示回数、サイトクリック、経路リクエスト)を取る。
// マップパックは「順位」をAPIで取れないので、効果測定はこの表示回数の推移で見る。
//
// 採用API: Business Profile Performance API
//   GET https://businessprofileperformance.googleapis.com/v1/locations/{id}:fetchMultiDailyMetricsTimeSeries
//
// 🔴 認証について(重要):
//   スコープは既存の GBP OAuth (business.manage) で**足りている**。再認可は不要。
//   ただし Google Cloud プロジェクトで **Business Profile Performance API の有効化が必要**。
//   未有効だと 403 PERMISSION_DENIED (SERVICE_DISABLED) が返る。
//   有効化URL: https://console.developers.google.com/apis/api/businessprofileperformance.googleapis.com/overview
//
// 制限: 日次データは過去18ヶ月まで。当日〜数日分は反映が遅れる。

import { GBP_METRICS } from './seoTracking';

const BASE = 'https://businessprofileperformance.googleapis.com/v1';

export function configured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GBP_REFRESH_TOKEN &&
    process.env.GBP_LOCATION_ID
  );
}

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    refresh_token: process.env.GBP_REFRESH_TOKEN ?? '',
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`GBPトークン取得失敗 ${res.status}: ${raw.slice(0, 200)}`);
  const token = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!token) throw new Error('GBPトークン: access_tokenが空');
  return token;
}

export type DailyMetric = { metric_date: string; metric: string; value: number };

/** APIが有効化されていない場合に投げるエラー(呼び出し側で案内を出し分けるため) */
export class PerformanceApiDisabledError extends Error {}

/**
 * 期間内の日次指標を取る。start/end は 'YYYY-MM-DD'。
 * APIが未有効なら PerformanceApiDisabledError を投げる。
 */
export async function fetchDailyMetrics(start: string, end: string): Promise<DailyMetric[]> {
  if (!configured()) throw new Error('GBP連携env未設定');
  const token = await getAccessToken();

  const q = new URLSearchParams();
  for (const m of GBP_METRICS) q.append('dailyMetrics', m);
  const [sy, sm, sd] = start.split('-');
  const [ey, em, ed] = end.split('-');
  q.set('dailyRange.start_date.year', sy);
  q.set('dailyRange.start_date.month', String(Number(sm)));
  q.set('dailyRange.start_date.day', String(Number(sd)));
  q.set('dailyRange.end_date.year', ey);
  q.set('dailyRange.end_date.month', String(Number(em)));
  q.set('dailyRange.end_date.day', String(Number(ed)));

  const url = `${BASE}/locations/${process.env.GBP_LOCATION_ID}:fetchMultiDailyMetricsTimeSeries?${q}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 403 && raw.includes('SERVICE_DISABLED')) {
      throw new PerformanceApiDisabledError(
        'Business Profile Performance API が未有効です。Google Cloud コンソールで有効化してください（再認可は不要）'
      );
    }
    throw new Error(`GBP performance ${res.status}: ${raw.slice(0, 300)}`);
  }

  return parseMultiDailyMetrics(JSON.parse(raw));
}

type ApiShape = {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: {
      dailyMetric?: string;
      timeSeries?: {
        datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string }[];
      };
    }[];
  }[];
};

/** レスポンスを日付×指標のフラットな行に潰す(純関数・テスト対象) */
export function parseMultiDailyMetrics(json: unknown): DailyMetric[] {
  const out: DailyMetric[] = [];
  // レスポンスがnull/非オブジェクトでも落とさない(APIエラー時に空ボディが来ることがある)
  const j = (json ?? {}) as ApiShape;
  for (const series of j.multiDailyMetricTimeSeries ?? []) {
    for (const ts of series.dailyMetricTimeSeries ?? []) {
      const metric = ts.dailyMetric;
      if (!metric) continue;
      for (const dv of ts.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        if (!d?.year || !d.month || !d.day) continue;
        const metric_date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        // valueが無い日は0(APIは0の日をvalue省略で返すことがある)
        out.push({ metric_date, metric, value: Number(dv.value ?? 0) });
      }
    }
  }
  return out;
}
