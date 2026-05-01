'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Share, Plus } from 'lucide-react';

// Pre-computed sparkle positions — keep stable across renders to avoid flicker
const WELCOME_SPARKLES = Array.from({ length: 8 }, (_, i) => {
  const s = i * 67 + 5;
  return { left: 15 + ((s * 17) % 70), top: 10 + ((s * 23) % 70), dur: 2 + ((s * 7) % 20) / 10, delay: ((s * 11) % 15) / 10 };
});

export default function WelcomePopup() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem('bw5_welcome_seen');
    if (seen) return;

    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).standalone === true;
    setIsIOS(ios);
    setIsStandalone(standalone);

    // Don't show if already in standalone (= already added to home)
    if (standalone) {
      localStorage.setItem('bw5_welcome_seen', '1');
      return;
    }

    const timer = setTimeout(() => setShow(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setShow(false);
    localStorage.setItem('bw5_welcome_seen', '1');
  };

  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100]"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
            onClick={handleClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', damping: 22, stiffness: 280 }}
            className="fixed inset-0 z-[101] flex items-center justify-center px-4 pointer-events-none"
          >
            <div
              className="w-full max-w-sm rounded-3xl overflow-hidden relative pointer-events-auto"
              style={{
                background: 'linear-gradient(170deg, #fff 0%, #fff7ed 100%)',
                boxShadow: '0 20px 60px rgba(220,76,4,0.35)',
              }}
            >
              {/* Close X */}
              <button
                onClick={handleClose}
                className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-90"
                style={{ background: 'rgba(0,0,0,0.06)' }}
                aria-label="閉じる"
              >
                <X size={16} style={{ color: '#666' }} />
              </button>

              {/* Hero image — BOOMくん with smartphone */}
              <div className="relative pt-4 pb-2 px-4" style={{
                background: 'radial-gradient(circle at 50% 30%, rgba(242,122,26,0.18) 0%, transparent 60%)',
              }}>
                {/* Floating sparkles — fixed positions to avoid re-render flicker */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {WELCOME_SPARKLES.map((p, i) => (
                    <motion.span
                      key={i}
                      className="absolute text-base"
                      style={{ left: `${p.left}%`, top: `${p.top}%` }}
                      animate={{ y: [0, -10, 0], opacity: [0.3, 0.9, 0.3] }}
                      transition={{ duration: p.dur, repeat: Infinity, delay: p.delay }}
                    >
                      ✨
                    </motion.span>
                  ))}
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/boomkun_phone.png"
                  alt="BOOMくんがスマホでホーム画面追加を案内"
                  className="relative w-full max-w-[280px] mx-auto object-contain"
                  style={{ aspectRatio: '3 / 4', filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.18))' }}
                />
              </div>

              {/* Headline */}
              <div className="px-6 pt-1 pb-3 text-center">
                <h2 className="text-xl font-black tracking-tight" style={{ color: '#dc4c04' }}>
                  ホーム画面に追加してね
                </h2>
                <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: '#666' }}>
                  当日サクッと開ける専用アプリに変身✨
                  <br />本番＆カウントダウンを最高に楽しもう
                </p>
              </div>

              {/* iOS-specific instructions */}
              {isIOS ? (
                <div className="mx-5 mb-4 rounded-2xl p-3.5 space-y-2.5" style={{ background: '#fff', border: '1.5px solid rgba(242,122,26,0.25)' }}>
                  <Step
                    n={1}
                    icon={<Share size={18} style={{ color: '#0a84ff' }} />}
                    text="画面下の"
                    badge="共有ボタン"
                    badgeIcon={<Share size={11} style={{ color: '#0a84ff' }} />}
                    badgeColor="#e8f1ff"
                    after="をタップ"
                  />
                  <Step
                    n={2}
                    icon={<Plus size={18} style={{ color: '#dc4c04' }} />}
                    text="メニューから"
                    badge="ホーム画面に追加"
                    badgeIcon={<Plus size={11} style={{ color: '#dc4c04' }} />}
                    badgeColor="#fff0e6"
                    after=""
                  />
                </div>
              ) : (
                <div className="mx-5 mb-4 rounded-2xl p-3.5" style={{ background: '#fff', border: '1.5px solid rgba(242,122,26,0.25)' }}>
                  <p className="text-xs leading-relaxed" style={{ color: '#444' }}>
                    Chrome / Safari の <strong>メニュー（︙ または □）</strong> から
                    <br />→ <strong className="text-orange-600">「ホーム画面に追加」</strong>を選択
                  </p>
                </div>
              )}

              {/* Big CTA */}
              <div className="px-5 pb-5">
                <button
                  onClick={handleClose}
                  className="w-full py-3.5 rounded-2xl text-base font-black text-white transition-transform active:scale-[0.97]"
                  style={{
                    background: 'linear-gradient(135deg, #f27a1a 0%, #dc4c04 100%)',
                    boxShadow: '0 6px 16px rgba(220,76,4,0.35)',
                  }}
                >
                  わかった！はじめる →
                </button>
                <button
                  onClick={handleClose}
                  className="w-full mt-2 py-2 text-xs font-medium"
                  style={{ color: '#999' }}
                >
                  あとで（ブラウザのまま使う）
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Step({
  n,
  icon,
  text,
  badge,
  badgeIcon,
  badgeColor,
  after,
}: {
  n: number;
  icon: React.ReactNode;
  text: string;
  badge: string;
  badgeIcon: React.ReactNode;
  badgeColor: string;
  after: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center font-black text-white shrink-0 text-sm"
        style={{ background: '#f27a1a' }}
      >
        {n}
      </div>
      <div className="text-xs font-bold flex items-center gap-1 flex-wrap" style={{ color: '#333' }}>
        <span>{text}</span>
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black"
          style={{ background: badgeColor, color: '#222' }}
        >
          {badgeIcon}
          {badge}
        </span>
        {after && <span>{after}</span>}
      </div>
    </div>
  );
}
