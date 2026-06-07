'use client';

import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import StaffSidebar from './StaffSidebar';
import CommandPalette from './CommandPalette';

export default function StaffLayoutClient({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <StaffSidebar onOpenCommandPalette={() => setCommandOpen(true)} />
        <SidebarInset className="bg-neutral-50 text-neutral-900">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3 md:hidden">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold text-orange-600">BOOM Staff</span>
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
