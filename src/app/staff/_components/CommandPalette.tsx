'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Database,
  Calendar,
  Wallet,
  Receipt,
  Building2,
  BarChart3,
  Users,
  FileText,
  Settings2,
  Video,
  AtSign,
  XCircle,
  PartyPopper,
  Radio,
  Rocket,
  RefreshCw,
  Hash,
  Sparkles,
  ShoppingBag,
  ClipboardList,
} from 'lucide-react';
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';

type PageEntry = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

const pages: PageEntry[] = [
  { title: 'スタッフHub', href: '/staff', icon: BarChart3 },
  { title: 'マスタ管理', href: '/staff/masters', icon: Database },
  { title: 'カレンダー', href: '/staff/schedule/calendar', icon: Calendar },
  { title: 'スケジュール同期', href: '/staff/schedule/sync', icon: Radio },
  { title: 'HACOMONO連携', href: '/staff/schedule/hacomono-tasks', icon: Calendar },
  { title: '給与計算', href: '/staff/payroll', icon: Wallet },
  { title: '経費管理', href: '/staff/expenses', icon: Receipt },
  { title: 'スタジオ請求', href: '/staff/studio-billing', icon: Building2 },
  { title: 'KPI・分析', href: '/staff/insights', icon: BarChart3 },
  { title: '会員管理', href: '/staff/members', icon: Users },
  { title: 'ブログ', href: '/staff/blog', icon: FileText },
  { title: '体験予約', href: '/staff/trials', icon: Sparkles },
  { title: 'オペレーション', href: '/staff/operations', icon: Settings2 },
  { title: 'Instagram投稿', href: '/staff/instagram', icon: AtSign },
  { title: 'X投稿', href: '/staff/x-posts', icon: Hash },
  { title: '映像予約', href: '/staff/video-preorders', icon: Video },
  { title: '休講申請', href: '/staff/cancel-requests', icon: XCircle },
  { title: 'イベント', href: '/staff/events', icon: PartyPopper },
  { title: 'レジ(無人物販)', href: '/staff/kiosk', icon: ShoppingBag },
  { title: 'アンケート', href: '/staff/surveys', icon: ClipboardList },
];

type ActionEntry = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
};

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  // Register global ⌘K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const navigateTo = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [router, onOpenChange],
  );

  const actions: ActionEntry[] = [
    {
      title: 'HP Deploy (Vercel)',
      icon: Rocket,
      action: () => {
        onOpenChange(false);
        window.open('https://vercel.com/dashboard', '_blank');
      },
    },
    {
      title: 'Google Calendar 同期',
      icon: RefreshCw,
      action: () => {
        navigateTo('/staff/schedule/sync');
      },
    },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="コマンドパレット"
      description="ページやアクションを検索"
    >
      <Command>
        <CommandInput placeholder="検索..." />
        <CommandList>
          <CommandEmpty>該当なし</CommandEmpty>
          <CommandGroup heading="ページ">
            {pages.map((page) => {
              const Icon = page.icon;
              return (
                <CommandItem
                  key={page.href}
                  onSelect={() => navigateTo(page.href)}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span>{page.title}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="アクション">
            {actions.map((act) => {
              const Icon = act.icon;
              return (
                <CommandItem key={act.title} onSelect={act.action}>
                  <Icon className="size-4 text-muted-foreground" />
                  <span>{act.title}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
