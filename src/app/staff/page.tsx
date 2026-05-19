'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Stats = {
  members: { active: number; withdrew: number; unlinked: number };
  lessons: { active: number };
  videoPreorders: { total: number; unsent: number };
  merch: { total: number; pending: number };
  events: { total: number };
  trials: { total: number };
  monthly: { reports: number };
  generated_at: string;
};

type Card = {
  href: string;
  icon: string;
  title: string;
  description: string;
  stat?: (s: Stats) => { label: string; value: string | number; alert?: boolean }[];
};

const CARDS: Card[] = [
  {
    href: '/staff/masters',
    icon: '🗂️',
    title: 'マスターデータ',
    description: 'スタジオ・インストラクター・レッスン定義',
  },
  {
    href: '/staff/dashboard',
    icon: '📊',
    title: 'KPIダッシュボード',
    description: '入会・退会・体験の月次推移と自動集計',
    stat: s => [
      { label: '月次レポート', value: s.monthly.reports },
    ],
  },
  {
    href: '/staff/members',
    icon: '👥',
    title: '会員管理',
    description: 'HACOMONO会員の検索・プラン・Lstep紐付け',
    stat: s => [
      { label: '在籍会員', value: s.members.active },
      { label: '未紐付け', value: s.members.unlinked, alert: s.members.unlinked > 0 },
    ],
  },
  {
    href: '/staff/schedule/calendar',
    icon: '📅',
    title: 'レッスンカレンダー',
    description: '月別レッスン予定 (マスター展開+実開催)',
    stat: s => [
      { label: '登録クラス', value: s.lessons.active },
    ],
  },
  {
    href: '/staff/operations',
    icon: '🔄',
    title: '運営オペレーション',
    description: '月次CSV突合・紐付け推測・月次レポート生成',
    stat: s => [
      { label: '体験記録', value: s.trials.total },
    ],
  },
  {
    href: '/staff/video-preorders',
    icon: '📹',
    title: '映像予約 管理',
    description: 'BW5映像データ予約・確認メール・支払いリンク管理',
    stat: s => [
      { label: '予約', value: s.videoPreorders.total },
      { label: '未送信', value: s.videoPreorders.unsent, alert: s.videoPreorders.unsent > 0 },
    ],
  },
  {
    href: '/staff/orders',
    icon: '🛍️',
    title: '物販注文 管理',
    description: 'BW5物販・追加注文・支払い状況',
    stat: s => [
      { label: '注文', value: s.merch.total },
      { label: '未払い', value: s.merch.pending, alert: s.merch.pending > 0 },
    ],
  },
  {
    href: '/staff/events',
    icon: '🎪',
    title: 'イベント管理',
    description: 'BW5・発表会等のイベント設定・タスク',
    stat: s => [
      { label: 'イベント', value: s.events.total },
    ],
  },
  {
    href: '/staff/backstage',
    icon: '🎨',
    title: 'バックステージ',
    description: '出演者情報・写真公開フェーズ',
  },
];

export default function StaffHubPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    fetch('/api/staff/hub-stats', { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) {
          window.location.href = '/staff/events/login?next=/staff';
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Stats | null) => { if (d) setStats(d); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="bg-white border-b border-orange-100 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-baseline justify-between gap-3 flex-wrap">
          <h1 className="text-lg sm:text-xl font-bold text-orange-600">🎯 BOOM スタッフ管理</h1>
          <p className="text-xs text-neutral-500">
            {stats?.generated_at
              ? `最終更新: ${new Date(stats.generated_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
              : '読込中...'}
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        {err && (
          <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">
            読込エラー: {err}
          </div>
        )}

        {/* アラートサマリ */}
        {stats && (() => {
          const alerts: string[] = [];
          if (stats.videoPreorders.unsent > 0) alerts.push(`映像予約 未送信 ${stats.videoPreorders.unsent}件`);
          if (stats.merch.pending > 0) alerts.push(`物販 未払い ${stats.merch.pending}件`);
          if (stats.members.unlinked > 0) alerts.push(`会員 未紐付け ${stats.members.unlinked}件`);
          if (alerts.length === 0) return null;
          return (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs sm:text-sm font-semibold text-amber-900 mb-1">⚠️ 要対応</p>
              <div className="flex flex-wrap gap-2">
                {alerts.map((a, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white border border-amber-300 text-amber-800">{a}</span>
                ))}
              </div>
            </div>
          );
        })()}

        {/* カードグリッド */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {CARDS.map(card => (
            <Link
              key={card.href}
              href={card.href}
              className="bg-white border border-neutral-200 hover:border-orange-300 hover:shadow-md transition-all rounded-xl p-4 flex flex-col gap-2 group"
            >
              <div className="flex items-start gap-2">
                <div className="text-2xl">{card.icon}</div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-orange-700 group-hover:text-orange-800">{card.title}</h2>
                  <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{card.description}</p>
                </div>
                <div className="text-orange-400 group-hover:text-orange-600">→</div>
              </div>

              {stats && card.stat && (
                <div className="flex gap-3 pt-2 border-t border-neutral-100">
                  {card.stat(stats).map((s, i) => (
                    <div key={i} className="flex-1">
                      <div className="text-[10px] text-neutral-500">{s.label}</div>
                      <div className={`text-lg font-bold ${s.alert ? 'text-amber-700' : 'text-neutral-800'}`}>
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!stats && card.stat && loading && (
                <div className="pt-2 border-t border-neutral-100 text-xs text-neutral-400">読込中...</div>
              )}
            </Link>
          ))}
        </div>

        {/* フッター */}
        <footer className="mt-8 text-center text-xs text-neutral-400">
          BOOM Dance School / Staff Hub
        </footer>
      </div>
    </main>
  );
}
