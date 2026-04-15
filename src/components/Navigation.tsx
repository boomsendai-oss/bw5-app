'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ShoppingBag, Video, Music, Star, Share2, Menu, X } from 'lucide-react';

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
      {/* Mobile floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full btn-primary flex items-center justify-center shadow-2xl md:hidden"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-24 right-6 z-40 glass rounded-2xl p-4 space-y-2 md:hidden"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => { onNavigate(item.id); setIsOpen(false); }}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all text-left ${
                    activeSection === item.id ? 'bg-[#e63946]/20 text-[#e63946]' : 'text-[#a0a0a0] hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </motion.div>
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
