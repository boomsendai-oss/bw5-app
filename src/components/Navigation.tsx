'use client';
import { motion } from 'framer-motion';
import { Calendar, ShoppingCart, Music, Star, Share2, Home, BookOpen } from 'lucide-react';

const navItems = [
  { id: 'hero', label: 'ホーム', icon: Home },
  { id: 'schedule', label: '演目情報', icon: Calendar },
  { id: 'pamphlet', label: 'パンフ', icon: BookOpen },
  { id: 'merch', label: 'ショップ', icon: ShoppingCart },
  { id: 'music', label: '音源', icon: Music },
  { id: 'vote', label: '投票', icon: Star },
  { id: 'sns', label: 'SNS', icon: Share2 },
];

export default function Navigation({
  activeSection,
  onNavigate,
  hiddenSections = [],
}: {
  activeSection: string;
  onNavigate: (id: string) => void;
  hiddenSections?: string[];
}) {
  const filteredNavItems = navItems.filter(
    (item) => !hiddenSections.includes(item.id)
  );

  return (
    <>
      {/* ── Mobile bottom tab bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
        style={{
          background: 'rgba(255,255,255,0.97)',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-stretch justify-around px-1 pt-1.5 pb-1">
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className="relative flex flex-col items-center justify-center flex-1 py-1.5 transition-all"
              >
                {/* Active indicator dot */}
                {isActive && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute -top-1.5 w-5 h-[3px] rounded-full"
                    style={{ background: '#f27a1a' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.5 : 1.8}
                  style={{
                    color: isActive ? '#f27a1a' : '#aaa',
                    transition: 'color 0.2s',
                  }}
                />
                <span
                  className="text-[9px] font-bold mt-0.5 leading-tight"
                  style={{
                    color: isActive ? '#f27a1a' : '#aaa',
                    transition: 'color 0.2s',
                  }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Desktop sticky top nav ── */}
      <nav className="hidden md:block sticky top-0 z-30 glass border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 flex items-center gap-1 overflow-x-auto py-2">
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-all text-sm ${
                  activeSection === item.id
                    ? 'bg-white/20 text-white font-semibold'
                    : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
