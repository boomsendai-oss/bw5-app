// SEO順位トラッキング (Server Component)
// 「順位が上がった気がする」を検証できるようにするための画面。
// 体感比較は変動と区別できないので、同じキーワードの推移を数字で見る。
import StaffPageHeader from '@/components/StaffPageHeader';
import { getAll } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import {
  buildTrends,
  formatPosition,
  rankTier,
  sumByMonth,
  GBP_METRIC_LABEL,
  type RankRow,
} from '@/lib/seoTracking';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIER_STYLE: Record<string, { label: string; cls: string }> = {
  top3: { label: '地図3枠圏', cls: 'bg-brand-100 text-brand-900' },
  page1: { label: '1ページ目', cls: 'bg-brand-50 text-brand-800' },
  page2: { label: '2ページ目', cls: 'bg-sand-100 text-navy-700' },
  far: { label: 'クリックほぼ0', cls: 'bg-red-50 text-red-700' },
};

const DIR: Record<string, string> = { up: '▲', down: '▼', flat: '－', unknown: '?' };
const DIR_CLS: Record<string, string> = {
  up: 'text-brand-700',
  down: 'text-red-600',
  flat: 'text-muted-foreground',
  unknown: 'text-muted-foreground',
};

export default async function SeoPage() {
  if (!(await isAuthorizedServer())) {
    return (
      <div>
        <StaffPageHeader title="SEO順位トラッキング" backHref="/staff" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。
            <a href="/staff" className="text-brand-600 underline">
              スタッフトップ
            </a>
            からログインしてください。
          </p>
        </div>
      </div>
    );
  }

  const ranks = (await getAll(
    `SELECT measured_on, source, query, target, position, out_of_range
     FROM seo_rank_snapshots ORDER BY measured_on`
  )) as (RankRow & { source: string })[];
  const trends = buildTrends(ranks);

  const perf = (await getAll(
    `SELECT metric_date, metric, value FROM gbp_performance_daily
     WHERE metric_date >= date('now', '-6 months')`
  )) as { metric_date: string; metric: string; value: number }[];
  const monthly = sumByMonth(perf);
  const months = [...new Set(monthly.map((m) => m.month))].sort();
  const metrics = [...new Set(monthly.map((m) => m.metric))].sort();
  const cell = new Map(monthly.map((m) => [`${m.month} ${m.metric}`, m.total]));

  return (
    <div>
      <StaffPageHeader
        title="SEO順位トラッキング"
        description="同じキーワードの推移を記録する。体感ではなく数字で施策の効果を判断するため"
        backHref="/staff"
      />
      <div className="p-4 max-w-4xl mx-auto space-y-6">
        {ranks.length === 0 && (
          <div className="rounded-lg border border-sand-300 bg-sand-50 p-4 text-sm">
            まだ記録がありません。ベースライン投入スクリプトを実行してください。
          </div>
        )}

        {/* 検索順位 */}
        <section>
          <h2 className="text-sm font-semibold text-navy-800 mb-2">検索順位の推移</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] min-w-[560px]">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-b">
                  <th className="text-left py-2 px-2">キーワード</th>
                  <th className="text-left py-2 px-2">対象</th>
                  <th className="text-right py-2 px-2">最初</th>
                  <th className="text-right py-2 px-2">最新</th>
                  <th className="text-right py-2 px-2">変化</th>
                  <th className="text-left py-2 px-2">位置</th>
                </tr>
              </thead>
              <tbody>
                {trends.map((t) => {
                  const tier = TIER_STYLE[rankTier(t.latest.position)];
                  return (
                    <tr key={`${t.query}-${t.target}`} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium text-navy-800">{t.query}</td>
                      <td className="py-2 px-2 text-muted-foreground text-[11px]">
                        {t.target === 'hp' ? 'HP' : t.target === 'instagram' ? 'Insta' : t.target}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                        {formatPosition(t.first.position)}
                        <span className="block text-[10px]">{t.first.on.slice(5)}</span>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">
                        {formatPosition(t.latest.position)}
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          {t.latest.on.slice(5)}
                        </span>
                      </td>
                      <td className={`py-2 px-2 text-right tabular-nums ${DIR_CLS[t.direction]}`}>
                        {DIR[t.direction]}
                        {t.delta != null && t.delta !== 0 ? ` ${Math.abs(t.delta)}` : ''}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${tier.cls}`}>
                          {tier.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
            ▲ = 順位が上がった。ローカル検索のクリックは1ページ目に集中し、
            <strong>2ページ目以降は実質ゼロ</strong>。順位が上がっても「クリックほぼ0」の帯にいる間は
            成果として数えない。
          </p>
        </section>

        {/* GBPパフォーマンス */}
        <section>
          <h2 className="text-sm font-semibold text-navy-800 mb-2">
            GBPパフォーマンス（マップパック側の効果測定）
          </h2>
          {months.length === 0 ? (
            <div className="rounded-lg border border-sand-300 bg-sand-50 p-3 text-[13px] leading-relaxed">
              まだデータがありません。
              <strong>Business Profile Performance API の有効化</strong>が必要です
              （Google Cloud コンソールで有効化するだけ。<strong>再認可は不要</strong>＝
              既存のGBP認証スコープでカバーされています）。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] min-w-[480px]">
                <thead>
                  <tr className="text-[11px] text-muted-foreground border-b">
                    <th className="text-left py-2 px-2">指標</th>
                    {months.map((m) => (
                      <th key={m} className="text-right py-2 px-2">
                        {m.slice(2)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((mt) => (
                    <tr key={mt} className="border-b last:border-0">
                      <td className="py-2 px-2">{GBP_METRIC_LABEL[mt] ?? mt}</td>
                      {months.map((m) => (
                        <td key={m} className="py-2 px-2 text-right tabular-nums">
                          {(cell.get(`${m} ${mt}`) ?? 0).toLocaleString()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-sand-300 bg-sand-50 p-3 text-[12px] leading-relaxed space-y-1.5">
          <p className="font-semibold text-navy-800">読み方のメモ</p>
          <p>
            <strong>マップパック（地図3枠）</strong>は、BOOMがサービス提供地域ビジネス（住所ピンなし）
            のため構造的に入りづらい。根治は新スタジオ開業で正当な住所を持つこと。
            <strong>バーチャルオフィスはガイドライン違反</strong>で、停止されるとクチコミが失われる。
          </p>
          <p>
            <strong>オーガニック順位</strong>は今すぐ改善できる。最大の要因は、新HP（57ページ・
            ブログ8本）を本番ドメインに載せること。移管が完了するまでは、
            Googleが評価しているのは中身の薄い旧サイト。
          </p>
          <p>
            <strong>クチコミは「新しさ」が上位要因</strong>。目標件数に到達しても声がけを止めない。
            止めると時間とともに評価が落ちる。
          </p>
        </section>
      </div>
    </div>
  );
}
