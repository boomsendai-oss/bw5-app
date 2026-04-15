'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, ShoppingBag, Video, Music, Star, Share2, Smartphone } from 'lucide-react';

const features = [
  { icon: Calendar, label: 'タイムテーブル', desc: '全23ナンバーの出演順を確認' },
  { icon: ShoppingBag, label: 'グッズ購入', desc: 'オリジナルキャップを事前予約' },
  { icon: Video, label: '映像データ', desc: 'イベント全編映像を購入' },
  { icon: Music, label: '音源リリース', desc: '新曲の配信情報をチェック' },
  { icon: Star, label: 'キャラ名投票', desc: 'BOOMくんの名前を決めよう' },
  { icon: Share2, label: 'SNS', desc: '最新情報をフォロー' },
];

export default function WelcomePopup() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if already seen
    const seen = localStorage.getItem('bw5_welcome_seen');
    if (seen) return;

    // Check platform
    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua));
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

    // Show after a short delay
    const timer = setTimeout(() => setShow(true), 800);
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
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Popup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 top-[10vh] bottom-auto z-[101] max-w-md mx-auto rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(180deg, rgba(30,30,30,0.98) 0%, rgba(15,15,15,0.98) 100%)' }}
          >
            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X size={16} className="text-white/70" />
            </button>

            {/* Header */}
            <div className="px-6 pt-8 pb-4 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/boomkun.png"
                alt="BOOM WOP vol.5"
                className="w-20 h-20 mx-auto mb-4 object-contain drop-shadow-[0_0_20px_rgba(230,57,70,0.4)]"
              />
              <h2 className="text-2xl font-black tracking-tight gradient-text mb-1">
                BOOM WOP vol.5
              </h2>
              <p className="text-sm text-[var(--text-secondary)] tracking-wider">
                デジタルパンフレット
              </p>
            </div>

            {/* Features grid */}
            <div className="px-5 pb-4">
              <div className="grid grid-cols-2 gap-2">
                {features.map((f) => {
                  const Icon = f.icon;
                  return (
                    <div key={f.label} className="flex items-start gap-2.5 p-3 rounded-xl bg-white/[0.04]">
                      <div className="w-8 h-8 rounded-lg bg-[#e63946]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Icon size={15} className="text-[#e63946]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white leading-tight">{f.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)] leading-snug mt-0.5">{f.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Add to home screen hint */}
            {!isStandalone && (
              <div className="mx-5 mb-4 p-3.5 rounded-xl border border-[#e63946]/20 bg-[#e63946]/[0.06]">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#e63946]/20 flex items-center justify-center flex-shrink-0">
                    <Smartphone size={16} className="text-[#e63946]" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white mb-1">ホーム画面に追加しよう！</p>
                    {isIOS ? (
                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                        画面下の <span className="inline-block px-1 py-0.5 bg-white/10 rounded text-[10px]">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
                        </span> 共有ボタン →「ホーム画面に追加」でアプリのように使えます
                      </p>
                    ) : (
                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                        ブラウザメニュー →「ホーム画面に追加」でアプリのように使えます
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* CTA */}
            <div className="px-5 pb-6">
              <button
                onClick={handleClose}
                className="w-full py-3.5 rounded-2xl btn-primary text-sm font-bold tracking-wider"
              >
                はじめる 🎶
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
