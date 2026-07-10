'use client';

import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import StaffSidebar from './StaffSidebar';
import CommandPalette from './CommandPalette';

export default function StaffLayoutClient({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);

  // body/html の下地はサイト全体でBW5オレンジ(globals.cssのvar(--bg-primary))。
  // スタッフ画面ではスクロールバウンス時やセーフエリアにオレンジが覗くため、
  // 滞在中だけニュートラルに上書きする(離脱時は復元)。globals.cssの:has()ルールの保険。
  useEffect(() => {
    const prevBody = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    document.body.style.background = '#fafafa';
    document.documentElement.style.background = '#fafafa';
    return () => {
      document.body.style.background = prevBody;
      document.documentElement.style.background = prevHtml;
    };
  }, []);

  return (
    <TooltipProvider>
      {/* .staff-theme: shadcnトークンをブランド色(ティール)に上書き (globals.css参照) */}
      <SidebarProvider className="staff-theme">
        <StaffSidebar onOpenCommandPalette={() => setCommandOpen(true)} />
        <SidebarInset className="bg-neutral-50 text-neutral-900">
          {/* モバイルヘッダー: ブランドのネイビーで公式感 */}
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-navy-800 bg-navy-700 px-3 md:hidden">
            <SidebarTrigger className="-ml-1 text-white hover:bg-navy-600 hover:text-white" />
            <span className="text-sm font-semibold text-white">BOOM Staff</span>
          </header>
          <div className="flex-1">
            {children}
          </div>
        </SidebarInset>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </SidebarProvider>
    </TooltipProvider>
  );
}
