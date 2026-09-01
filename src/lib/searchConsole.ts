// src/lib/searchConsole.ts — Node.js runtime 専用。
//
// Search Console の検索アナリティクスから、クエリ別の平均掲載順位・表示回数・クリックを取る。
//
// なぜGSCか: 順位を知る方法として、Googleを自動で検索して数えるのは規約違反かつ不安定で、
// 有料のランク計測APIは費用がかかる。GSCは**実際の検索で自社が何位に出たかの実測値**を
// 無料で返すので、これが唯一まともな一次情報になる。
//
// 採用API: POST https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query
//
// 🔴 前提:
//   1. **ドメイン移管の完了が必要**。現在 www.boom-sendai.com は旧Wixサイトを配信していて、
//      新HP(57ページ・ブログ8本)は boom-hp.pages.dev にしかない。移管前にGSCを繋いでも
//      測っているのは旧サイトの成績になる。
//   2. スコープ `https://www.googleapis.com/auth/webmasters.readonly` の追加認可が必要
//      (GBPのbusiness.manageではカバーされない)。env: `GSC_REFRESH_TOKEN`
//   3. Search Console でプロパティが検証済みであること
//
// 注意: GSCは「表示された」クエリしか返さない。圏外のキーワードは行が来ない=データ無し。
// 圏外の確認は手動計測(source='manual')で補う。

const ENDPOINT = 'https://searchconsole.googleapis.com/webmasters/v3';

export function configured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GSC_REFRESH_TOKEN &&
    process.env.GSC_SITE_URL
  );
}

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    refresh_token: process.env.GSC_REFRESH_TOKEN ?? '',
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`GSCトークン取得失敗 ${res.status}: ${raw.slice(0, 200)}`);
  const token = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!token) throw new Error('GSCトークン: access_tokenが空');
  return token;
}

export type GscRow = {
  query: string;
  page?: string;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
};

/** 期間内のクエリ別成績を取る。start/end は 'YYYY-MM-DD'。 */
export async function fetchQueryStats(start: string, end: string, rowLimit = 500): Promise<GscRow[]> {
  if (!configured()) throw new Error('Search Console連携env未設定');
  const token = await getAccessToken();
  const site = encodeURIComponent(process.env.GSC_SITE_URL ?? '');

  const res = await fetch(`${ENDPOINT}/sites/${site}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: start,
      endDate: end,
      dimensions: ['query'],
      rowLimit,
      // 日本からの検索に絞る(海外からのノイズを除く)
      dimensionFilterGroups: [
        { filters: [{ dimension: 'country', operator: 'equals', expression: 'jpn' }] },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`GSC searchAnalytics ${res.status}: ${raw.slice(0, 300)}`);
  return parseQueryStats(JSON.parse(raw));
}

/** レスポンスを行に潰す(純関数・テスト対象) */
export function parseQueryStats(json: unknown): GscRow[] {
  // レスポンスがnull/非オブジェクトでも落とさない
  const j = (json ?? {}) as {
    rows?: { keys?: string[]; position?: number; impressions?: number; clicks?: number; ctr?: number }[];
  };
  return (j.rows ?? [])
    .filter((r) => r.keys?.[0])
    .map((r) => ({
      query: r.keys![0],
      position: Number(r.position ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      ctr: Number(r.ctr ?? 0),
    }));
}

/**
 * 追跡対象のキーワードだけに絞る。
 * GSCのクエリは表記ゆれ(全角スペース・語順)があるので、
 * 空白を無視した部分一致で拾う。
 */
export function filterTracked(rows: GscRow[], tracked: readonly { query: string }[]): GscRow[] {
  const norm = (s: string) => s.replace(/[\s　]/g, '');
  const keys = tracked.map((t) => norm(t.query));
  return rows.filter((r) => {
    const q = norm(r.query);
    return keys.some((k) => q === k);
  });
}

/** 期間内のページ別成績を取る。dimensions=['page']。 */
export async function fetchPageStats(start: string, end: string, rowLimit = 200): Promise<GscRow[]> {
  if (!configured()) throw new Error('Search Console連携env未設定');
  const token = await getAccessToken();
  const site = encodeURIComponent(process.env.GSC_SITE_URL ?? '');
  const res = await fetch(`${ENDPOINT}/sites/${site}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: start,
      endDate: end,
      dimensions: ['page'],
      rowLimit,
      dimensionFilterGroups: [
        { filters: [{ dimension: 'country', operator: 'equals', expression: 'jpn' }] },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`GSC searchAnalytics(page) ${res.status}: ${raw.slice(0, 300)}`);
  return parsePageStats(JSON.parse(raw));
}

/** page次元レスポンスを行に潰す(純関数)。GscRowのquery欄にページURLが入る */
export function parsePageStats(json: unknown): GscRow[] {
  const rows = parseQueryStats(json);
  return rows.map((r) => ({ ...r, page: r.query }));
}
