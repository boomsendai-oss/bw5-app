'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ShoppingBag, Video, Music, Star, Share2, X } from 'lucide-react';

const navItems = [
  { id: 'schedule', label: 'スケジュール', icon: Calendar },
  { id: 'merchandise', label: '物販', icon: ShoppingBag },
  { id: 'video', label: '映像データ', icon: Video },
  { id: 'music', label: '音源', icon: Music },
  { id: 'vote', label: '投票', icon: Star },
  { id: 'sns', label: 'SNS', icon: Share2 },
];

export default function Navigation({ activeSection, onNavigate }: { activeSection: string; onNavigate: (id: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile floating button — clear "MENU" label */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full shadow-2xl md:hidden overflow-hidden"
        style={{
          background: isOpen
            ? 'rgba(255,255,255,0.15)'
            : 'linear-gradient(135deg, #e63946 0%, #d62839 100%)',
          backdropFilter: isOpen ? 'blur(12px)' : 'none',
        }}
        whileTap={{ scale: 0.95 }}
        layout
      >
        {isOpen ? (
          <div className="flex items-center justify-center w-14 h-14">
            <X size={22} className="text-white" />
          </div>
        ) : (
          <div className="flex items-center gap-2 pl-5 pr-5 py-3.5">
            {/* Hamburger icon */}
            <div className="flex flex-col gap-[4px]">
              <span className="block w-[18px] h-[2px] bg-white rounded-full" />
              <span className="block w-[14px] h-[2px] bg-white/80 rounded-full" />
              <span className="block w-[18px] h-[2px] bg-white rounded-full" />
            </div>
            <span className="text-white text-xs font-bold tracking-widest uppercase">MENU</span>
          </div>
        )}
      </motion.button>

      {/* Mobile menu */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 60, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 60, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-24 right-6 z-40 rounded-2xl p-3 space-y-1 md:hidden overflow-hidden"
              style={{
                background: 'rgba(20,20,20,0.95)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
              }}
            >
              {/* Mini header */}
              <div className="px-3 pt-1 pb-2">
                <p className="text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] font-medium">セクション</p>
              </div>
              {navItems.map((item, i) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => { onNavigate(item.id); setIsOpen(false); }}
                    className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all text-left ${
                      isActive
                        ? 'bg-[#e63946]/15 text-[#e63946]'
                        : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
                    <span className={`text-sm ${isActive ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
                    {isActive && (
                      <motion.div
                        layoutId="nav-dot"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-[#e63946]"
                      />
                    )}
                  </motion.button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sticky nav */}
      <nav className="hidden md:block sticky top-0 z-30 glass border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 flex items-center gap-1 overflow-x-auto py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap transition-all text-sm ${
                  activeSection === item.id
                    ? 'bg-[#e63946]/20 text-[#e63946] font-semibold'
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
