'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Database,
  Calendar,
  Wallet,
  Receipt,
  Building2,
  BarChart3,
  Users,
  FileText,
  Settings2,
  MessageCircle,
  AtSign,
  Video,
  XCircle,
  PartyPopper,
  Search,
  Star,
  UserX,
  HelpCircle,
  Megaphone,
  Hash,
  Sparkles,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from '@/components/ui/sidebar';

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems?: { title: string; href: string }[];
};

const mainNavItems: NavItem[] = [
  { title: 'マスタ管理', href: '/staff/masters', icon: Database },
  {
    title: 'スケジュール',
    href: '/staff/schedule',
    icon: Calendar,
    subItems: [
      { title: 'カレンダー', href: '/staff/schedule/calendar' },
      { title: '同期', href: '/staff/schedule/sync' },
      { title: 'HACOMONO', href: '/staff/schedule/hacomono-tasks' },
    ],
  },
  { title: '給与計算', href: '/staff/payroll', icon: Wallet },
  { title: '経費管理', href: '/staff/expenses', icon: Receipt },
  { title: 'スタジオ請求', href: '/staff/studio-billing', icon: Building2 },
  { title: 'KPI・分析', href: '/staff/insights', icon: BarChart3 },
  {
    title: '会員管理',
    href: '/staff/members',
    icon: Users,
    subItems: [
      { title: '会員一覧', href: '/staff/members' },
      { title: '退会候補', href: '/staff/members/withdrawal-candidates' },
      { title: 'おかえりリスト', href: '/staff/members/dormant-outreach' },
    ],
  },
];

const opsNavItems: NavItem[] = [
  { title: 'ブログ', href: '/staff/blog', icon: FileText },
  { title: 'FAQ管理', href: '/staff/faq', icon: HelpCircle },
  { title: 'オペレーション', href: '/staff/operations', icon: Settings2 },
  { title: '体験予約', href: '/staff/trials', icon: Sparkles },
  { title: 'ノーショー候補', href: '/staff/operations/noshow', icon: UserX },
  { title: 'LINE連携', href: '/staff/operations/lstep-update', icon: MessageCircle },
  { title: 'Instagram投稿', href: '/staff/instagram', icon: AtSign },
  { title: 'リール自動生成', href: '/staff/reel-drafts', icon: Video },
  { title: 'X投稿', href: '/staff/x-posts', icon: Hash },
  { title: '映像予約', href: '/staff/video-preorders', icon: Video },
  { title: '休講申請', href: '/staff/cancel-requests', icon: XCircle },
  { title: 'クチコミ返信', href: '/staff/gbp-reviews', icon: Star },
  { title: 'クチコミ声がけ', href: '/staff/review-outreach', icon: Megaphone },
  { title: 'イベント', href: '/staff/events', icon: PartyPopper },
];

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                  <Link href={item.subItems ? item.subItems[0].href : item.href}>
                    <Icon className="size-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.subItems && isActive && (
                  <SidebarMenuSub>
                    {item.subItems.map((sub) => (
                      <SidebarMenuSubItem key={sub.href}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={pathname === sub.href}
                        >
                          <Link href={sub.href}>
                            <span>{sub.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export default function StaffSidebar({
  onOpenCommandPalette,
}: {
  onOpenCommandPalette?: () => void;
}) {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link
          href="/staff"
          className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-sidebar-accent transition-colors"
        >
          <div className="flex size-7 items-center justify-center rounded-md bg-brand-500 text-white text-xs font-bold">
            B
          </div>
          <span className="font-semibold text-sm">BOOM Staff</span>
        </Link>
        {onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left">検索...</span>
            <kbd className="pointer-events-none rounded border border-sidebar-border px-1 py-0.5 text-[10px] font-mono">
              ⌘K
            </kbd>
          </button>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === '/staff'}
                  tooltip="ホーム"
                >
                  <Link href="/staff">
                    <Home className="size-4" />
                    <span>ホーム</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <NavGroup label="管理" items={mainNavItems} pathname={pathname} />
        <NavGroup label="運用" items={opsNavItems} pathname={pathname} />
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 py-1 text-[11px] text-sidebar-foreground/50">
          BOOM Staff
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
