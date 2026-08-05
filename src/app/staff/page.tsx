'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';
import {
  Database,
  BarChart3,
  Wallet,
  Receipt,
  Building2,
  XCircle,
  Users,
  Calendar,
  Radio,
  RefreshCw,
  Video,
  ShoppingBag,
  PartyPopper,
  Palette,
  FileText,
  Flame,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

type Stats = {
  lineClicks?: { total7: number; ads7: number }; // GA4 LINE誘導クリック(クライアント側で合成)
  members: { active: number; withdrew: number; unlinked: number };
  lessons: { active: number };
  videoPreorders: { total: number; unsent: number };
  merch: { total: number; pending: number };
  events: { total: number };
  trials: { total: number };
  monthly: { reports: number };
  generated_at: string;
};

type CardDef = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  stat?: (s: Stats) => { label: string; value: string | number; alert?: boolean }[];
};

const CARDS: CardDef[] = [
  {
    href: '/staff/masters',
    icon: Database,
    title: 'マスターデータ',
    description: 'スタジオ・インストラクター・レッスン定義',
  },
  {
    href: '/staff/insights',
    icon: BarChart3,
    title: '経営インサイト',
    description: '売上・顧客動態・稼働率・収益性をリアルタイム自動集計',
    stat: s => s.lineClicks ? [
      { label: 'LINEクリック7日', value: s.lineClicks.total7 },
      { label: 'うち広告', value: s.lineClicks.ads7 },
    ] : [],
  },
  {
    href: '/staff/payroll',
    icon: Wallet,
    title: '月次給与計算',
    description: 'レッスン単位で給与計算→PDF明細→Drive自動アップ',
  },
  {
    href: '/staff/expenses',
    icon: Receipt,
    title: '経費管理',
    description: '銀行明細→カテゴリ確定→月次集計 / 手動入力',
  },
  {
    href: '/staff/studio-billing',
    icon: Building2,
    title: '月次スタジオ料金',
    description: 'レッスン時間×単価で計算→キャンセル料調整→振込',
  },
  {
    href: '/staff/cancel-requests',
    icon: XCircle,
    title: '休講申請',
    description: 'インストラクターからの休講申請を承認/却下',
  },
  {
    href: '/staff/members',
    icon: Users,
    title: '会員管理',
    description: 'HACOMONO会員の検索・プラン・Lstep紐付け',
    stat: s => [
      { label: '在籍会員', value: s.members.active },
      { label: '未紐付け', value: s.members.unlinked, alert: s.members.unlinked > 0 },
    ],
  },
  {
    href: '/staff/schedule/calendar',
    icon: Calendar,
    title: 'レッスンカレンダー',
    description: '月別レッスン予定 (マスター展開+実開催)',
    stat: s => [
      { label: '登録クラス', value: s.lessons.active },
    ],
  },
  {
    href: '/staff/schedule/sync',
    icon: Radio,
    title: 'カレンダー連携',
    description: '3カレンダー(Google/HACOMONO/Lstep)へのスケジュール配信',
  },
  {
    href: '/staff/operations',
    icon: RefreshCw,
    title: '運営オペレーション',
    description: '月次CSV突合・紐付け推測・月次レポート生成',
    stat: s => [
      { label: '体験記録', value: s.trials.total },
    ],
  },
  {
    href: '/staff/video-preorders',
    icon: Video,
    title: '映像予約 管理',
    description: 'BW5映像データ予約・確認メール・支払いリンク管理',
    stat: s => [
      { label: '予約', value: s.videoPreorders.total },
      { label: '未送信', value: s.videoPreorders.unsent, alert: s.videoPreorders.unsent > 0 },
    ],
  },
  {
    href: '/staff/orders',
    icon: ShoppingBag,
    title: '物販注文 管理',
    description: 'BW5物販・追加注文・支払い状況',
    stat: s => [
      { label: '注文', value: s.merch.total },
      { label: '未払い', value: s.merch.pending, alert: s.merch.pending > 0 },
    ],
  },
  {
    href: '/staff/bf6',
    icon: Flame,
    title: "BOOMER'S FIGHT vol.6",
    description: 'バトルエントリー・観覧・決済(9/26開催)',
  },
  {
    href: '/staff/events',
    icon: PartyPopper,
    title: 'イベント管理',
    description: 'BW5・発表会等のイベント設定・タスク',
    stat: s => [
      { label: 'イベント', value: s.events.total },
    ],
  },
  {
    href: '/staff/backstage',
    icon: Palette,
    title: 'バックステージ',
    description: '出演者情報・写真公開フェーズ',
  },
  {
    href: '/staff/blog',
    icon: FileText,
    title: 'ブログ',
    description: 'BOOM公式HPのブログ記事を作成・編集・公開',
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

    // GA4 LINEクリック(別エンドポイント・1hキャッシュ)。失敗してもハブは普通に表示
    fetch('/api/staff/insights/line-clicks', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.ok) return;
        const r7 = (d.ranges as { days: number; total: number; ads: number }[]).find(x => x.days === 7);
        if (r7) setStats(prev => prev ? { ...prev, lineClicks: { total7: r7.total, ads7: r7.ads } } : prev);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <StaffPageHeader
        title="BOOM スタッフ管理"
        rightExtra={
          <p className="text-xs text-neutral-500">
            {stats?.generated_at
              ? `最終更新: ${new Date(stats.generated_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
              : '読込中...'}
          </p>
        }
      />
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
            <p className="text-xs sm:text-sm font-semibold text-amber-900 mb-1">要対応</p>
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
        {CARDS.map(card => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href} className="group">
              <Card className="h-full hover:border-brand-300 hover:shadow-md transition-all">
                <CardHeader>
                  <div className="flex items-start gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 group-hover:bg-brand-100">
                      <Icon className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-brand-700 group-hover:text-brand-800 text-sm">
                        {card.title}
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5 leading-relaxed">
                        {card.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                {stats && card.stat && (
                  <CardContent>
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
                  </CardContent>
                )}
                {!stats && card.stat && loading && (
                  <CardContent>
                    <div className="pt-2 border-t border-neutral-100 text-xs text-neutral-400">読込中...</div>
                  </CardContent>
                )}
              </Card>
            </Link>
          );
        })}
      </div>

      {/* フッター */}
      <footer className="mt-8 text-center text-xs text-neutral-400">
        BOOM Dance School / Staff Hub
      </footer>
      </div>
    </div>
  );
}
