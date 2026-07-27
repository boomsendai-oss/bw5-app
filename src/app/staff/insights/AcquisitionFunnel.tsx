'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatAdCost } from '@/lib/adCostFormat';

// 集客ファネル (WS AA / 2026-07-27)。
// page.tsx が既に1000行超のため、この機能のロジックと表示はここに閉じる。

type MonthlyRow = { ym: string; trials: number; enrolled: number; canceled: number; noshow: number; cvr: number | null };
type ReferralRow = { channel: string; trials: number; enrolled: number; cvr: number | null };
type Payload = {
  ok: boolean;
  month: string;
  monthly: MonthlyRow[];
  referral: ReferralRow[];
  ad: { available: boolean; error?: string; cost: number; clicks: number; currency: string };
  line_clicks_month: { available: boolean; error?: string; total: number; ads: number };
};

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const num = (v: number) => v.toLocaleString('ja-JP');

export default function AcquisitionFunnel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/staff/insights/acquisition-funnel')
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok || !json?.ok) {
          throw new Error(json?.error ?? `HTTP ${r.status}`);
        }
        return json as Payload;
      })
      .then(setData)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);

  if (error) return <p className="text-xs text-neutral-400">読み込みに失敗しました: {error}</p>;
  if (!data) return <p className="text-xs text-neutral-400">読込中...</p>;

  const cur = data.monthly.find((m) => m.ym === data.month);
  const adCurrencyWarn = data.ad.available && data.ad.currency && data.ad.currency !== 'JPY';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sand-200 p-3 text-sm">
        <div className="font-semibold text-navy-800 mb-1">{data.month} の集客ファネル</div>
        <div className="text-[10px] text-neutral-400 mb-2">当月分（GA4は数時間〜1日遅れ）</div>
        {adCurrencyWarn && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 mb-2 text-[11px] text-amber-900 flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>
              ⚠️ GA4プロパティの通貨が{data.ad.currency}のため、広告費は円ではありません。
              GA4管理画面でプロパティ通貨をJPYに変更すると正しく表示されます。
            </div>
          </div>
        )}
        <dl className="space-y-1">
          <Step
            label="広告費"
            value={data.ad.available ? formatAdCost(data.ad.cost, data.ad.currency) : '—'}
            note={data.ad.available ? undefined : 'GA4から取得できません'}
          />
          <Step label="広告クリック" value={data.ad.available ? num(data.ad.clicks) : '—'} />
          <Step
            label="LINEクリック"
            value={data.line_clicks_month.available ? `${num(data.line_clicks_month.total)} (うち広告 ${num(data.line_clicks_month.ads)})` : '—'}
            note={data.line_clicks_month.available ? undefined : 'GA4から取得できません'}
          />
          <Step label="体験 (来店)" value={cur ? num(cur.trials) : '0'} note={cur ? `キャンセル${cur.canceled} / ノーショー${cur.noshow}` : undefined} />
          <Step label="入会" value={cur ? `${num(cur.enrolled)}　CVR ${pct(cur.cvr)}` : '0'} />
        </dl>
      </div>

      <div>
        <div className="text-xs font-semibold text-navy-800 mb-1">月次推移</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-3">月</th><th className="py-1 pr-3">体験</th><th className="py-1 pr-3">入会</th><th className="py-1">CVR</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => (
                <tr key={m.ym} className="border-t border-sand-100">
                  <td className="py-1 pr-3">{m.ym}</td>
                  <td className="py-1 pr-3">{num(m.trials)}</td>
                  <td className="py-1 pr-3">{num(m.enrolled)}</td>
                  <td className="py-1">{pct(m.cvr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-navy-800 mb-1">流入経路別（全期間・自己申告ベース）</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="py-1 pr-3">経路</th><th className="py-1 pr-3">体験</th><th className="py-1 pr-3">入会</th><th className="py-1">CVR</th>
              </tr>
            </thead>
            <tbody>
              {data.referral.map((r) => (
                <tr key={r.channel} className="border-t border-sand-100">
                  <td className="py-1 pr-3">{r.channel}</td>
                  <td className="py-1 pr-3">{num(r.trials)}</td>
                  <td className="py-1 pr-3">{num(r.enrolled)}</td>
                  <td className="py-1">{pct(r.cvr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-neutral-400 leading-relaxed">
        母数が小さい経路のCVRは偶然で大きく振れます。件数を見てから判断してください。
        流入経路は2026-05以降の体験にしか記録がありません。
        「広告経由の入会」はLstepの流入経路タグ導入までは特定できないため、CPAは広告費÷広告経由のLINEクリックまでしか出せません。
      </p>
    </div>
  );
}

function Step({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right">
        <span className="font-semibold text-navy-800">{value}</span>
        {note && <span className="ml-2 text-[10px] text-neutral-400">{note}</span>}
      </dd>
    </div>
  );
}
