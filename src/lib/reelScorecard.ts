// リール成績サマリー(スコアカード)の生成。
// media_insights(毎日collect-insightsが貯める)から、各リールの「最新スナップショット」を1件ずつ取り、
// 本数・リーチ中央値・伸びた/伸びなかった型・一言講評を組む。純ロジック(送信はしない)。
//
// 目的: 「リールが集客に効いているか」を人が画面を見に行かなくても分かる状態にする。
// 使う側: 月次サマリーメール(insights-monthly cron)・判断日リマインダー。

import { getAll } from './db';

export type ReelRow = {
  media_id: string;
  title: string;
  posted_at: string | null;
  reach: number | null;
  views: number | null;
  saved: number | null;
  shares: number | null;
  total_interactions: number | null;
};

export type Scorecard = {
  count: number; // 集計対象リール本数
  since: string | null; // 最古の投稿日
  latest: string | null; // 最新の投稿日
  reachMedian: number | null;
  reachBest: { title: string; reach: number } | null;
  reachWorst: { title: string; reach: number } | null;
  saveRateMedian: number | null; // 保存/リーチ(質の指標)
  rows: ReelRow[];
  commentary: string; // 平易な一言講評
};

function median(nums: number[]): number | null {
  const a = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/**
 * リールの成績スコアカードを組む。
 * media_id ごとに最新 collected_date の行を採用(数字は数日かけて伸びるため最新が実力に近い)。
 * @param days 何日以内に投稿したリールを対象にするか(既定365=事実上全部)
 */
export async function buildReelScorecard(days = 365): Promise<Scorecard> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  // SQLiteのmax()+bare column: MAX(collected_date)の行の各値がそのまま返る。
  const rows = (await getAll(
    `SELECT media_id, title, posted_at,
            MAX(collected_date) AS collected_date,
            reach, views, saved, shares, total_interactions
     FROM media_insights
     WHERE kind = 'reel' AND (posted_at IS NULL OR posted_at >= ?)
     GROUP BY media_id
     ORDER BY posted_at ASC`,
    [cutoff]
  ).catch(() => [])) as Array<Record<string, unknown>>;

  const reels: ReelRow[] = rows.map((r) => ({
    media_id: String(r.media_id),
    title: String(r.title ?? 'リール'),
    posted_at: r.posted_at ? String(r.posted_at) : null,
    reach: r.reach == null ? null : Number(r.reach),
    views: r.views == null ? null : Number(r.views),
    saved: r.saved == null ? null : Number(r.saved),
    shares: r.shares == null ? null : Number(r.shares),
    total_interactions: r.total_interactions == null ? null : Number(r.total_interactions),
  }));

  const reaches = reels.map((r) => r.reach).filter((n): n is number => typeof n === 'number');
  const reachMedian = median(reaches);

  const withReach = reels.filter((r) => typeof r.reach === 'number') as (ReelRow & { reach: number })[];
  const sortedByReach = [...withReach].sort((a, b) => b.reach - a.reach);
  const reachBest = sortedByReach[0] ? { title: sortedByReach[0].title, reach: sortedByReach[0].reach } : null;
  const reachWorst =
    sortedByReach.length > 1
      ? { title: sortedByReach[sortedByReach.length - 1].title, reach: sortedByReach[sortedByReach.length - 1].reach }
      : null;

  const saveRates = withReach
    .filter((r) => typeof r.saved === 'number' && r.reach > 0)
    .map((r) => (r.saved as number) / r.reach);
  const saveRateMedian = saveRates.length ? Math.round(median(saveRates.map((x) => x * 1000)) ?? 0) / 10 : null; // %小数1桁

  const commentary = buildCommentary(reels.length, reachMedian, saveRateMedian);

  return {
    count: reels.length,
    since: reels[0]?.posted_at ?? null,
    latest: reels[reels.length - 1]?.posted_at ?? null,
    reachMedian,
    reachBest,
    reachWorst,
    saveRateMedian,
    rows: reels,
    commentary,
  };
}

/** 平易な一言講評。数字を解釈して「今どう読むか」を日本語で。 */
function buildCommentary(count: number, reachMed: number | null, saveRatePct: number | null): string {
  if (count === 0) return 'まだリールの成績データがありません。投稿が増えると集計されます。';
  if (count < 4) {
    return `まだ${count}本のみ。傾向を語るには少なすぎます(目安8本〜)。判断は8月下旬まで待つのが安全です。`;
  }
  const parts: string[] = [`リール${count}本のデータ。`];
  if (reachMed != null) {
    if (reachMed >= 1500) parts.push(`リーチ中央値${reachMed}は好調(フォロワー外に届いている)。`);
    else if (reachMed >= 600) parts.push(`リーチ中央値${reachMed}はまずまず。`);
    else parts.push(`リーチ中央値${reachMed}は伸び悩み。素材/冒頭2秒の見直し余地。`);
  }
  if (saveRatePct != null) {
    if (saveRatePct >= 1.5) parts.push(`保存率${saveRatePct}%は高く、"見込み客が後で見返す"良い兆候。`);
    else parts.push(`保存率${saveRatePct}%。保存は関心の強さの指標なので注視。`);
  }
  parts.push('※リーチ=認知の広さ / 保存=関心の強さ。入会は別要因(ローカル/LINE)も絡むため参考値。');
  return parts.join(' ');
}

/** メール本文用のプレーンテキスト整形。 */
export function formatScorecardText(sc: Scorecard): string {
  if (sc.count === 0) return sc.commentary;
  const L: string[] = [];
  L.push(`■ リール成績サマリー（${sc.count}本 / ${sc.since ?? '?'}〜${sc.latest ?? '?'}）`);
  L.push('');
  L.push(`リーチ中央値: ${sc.reachMedian ?? '—'}`);
  if (sc.reachBest) L.push(`最も伸びた: ${sc.reachBest.title}（リーチ${sc.reachBest.reach}）`);
  if (sc.reachWorst) L.push(`最も伸びず: ${sc.reachWorst.title}（リーチ${sc.reachWorst.reach}）`);
  if (sc.saveRateMedian != null) L.push(`保存率中央値: ${sc.saveRateMedian}%`);
  L.push('');
  L.push('各リール（最新値）:');
  for (const r of [...sc.rows].reverse()) {
    L.push(
      `・${r.title} | リーチ${r.reach ?? '—'} 再生${r.views ?? '—'} 保存${r.saved ?? '—'} 反応計${r.total_interactions ?? '—'}`
    );
  }
  L.push('');
  L.push(`【講評】${sc.commentary}`);
  L.push('');
  L.push('詳細: https://bw5-app.vercel.app/staff/instagram の「投稿パフォーマンス」');
  return L.join('\n');
}
