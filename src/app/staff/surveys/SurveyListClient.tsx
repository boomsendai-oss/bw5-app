'use client';

import Link from 'next/link';
import { useState } from 'react';

export type SurveyListItemView = {
  id: number;
  slug: string;
  title: string;
  status: string;
  state: string;
  opensAt: string | null;
  closesAt: string | null;
  responseCount: number;
  pendingCount: number;
};

export const STATE_BADGES: Record<string, { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-sand-100 text-navy-700 border-sand-300' },
  scheduled: { label: '受付開始前', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  accepting: { label: '受付中', cls: 'bg-brand-50 text-brand-700 border-brand-200' },
  expired: { label: '期限切れ', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  closed: { label: '終了', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export function formatPeriod(opensAt: string | null, closesAt: string | null): string {
  const fmt = (s: string) => s.replace('T', ' ');
  if (opensAt && closesAt) return `${fmt(opensAt)} 〜 ${fmt(closesAt)}`;
  if (opensAt) return `${fmt(opensAt)} 〜`;
  if (closesAt) return `〜 ${fmt(closesAt)}`;
  return '期間指定なし';
}

export default function SurveyListClient({ items }: { items: SurveyListItemView[] }) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const copyUrl = async (item: SurveyListItemView) => {
    const url = `${window.location.origin}/survey/${item.slug}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sm text-slate-500">
        アンケートはまだありません。「＋ 新規作成」から作成してください。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const badge = STATE_BADGES[item.state] ?? STATE_BADGES.draft;
        return (
          <div key={item.id} className="rounded-xl border border-sand-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <Link href={`/staff/surveys/${item.id}`} className="text-sm font-bold text-navy-800 hover:text-brand-700">
                  {item.title}
                </Link>
                <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-slate-500">
                  <span className={`rounded-full border px-2 py-0.5 font-bold ${badge.cls}`}>{badge.label}</span>
                  <span>{formatPeriod(item.opensAt, item.closesAt)}</span>
                  <span>回答 {item.responseCount}件</span>
                  {item.pendingCount > 0 ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-bold text-amber-700">
                      紐付け待ち {item.pendingCount}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.status !== 'draft' ? (
                  <button
                    type="button"
                    onClick={() => copyUrl(item)}
                    className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
                  >
                    {copiedId === item.id ? '✓ コピーしました' : '回答URLをコピー'}
                  </button>
                ) : null}
                <Link
                  href={`/staff/surveys/${item.id}`}
                  className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50"
                >
                  開く
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
