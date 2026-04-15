'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Smartphone } from 'lucide-react';

export default function AddToHomeScreen() {
  const [show, setShow] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Don't show if already installed as PWA
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    if (isStandalone) return;

    // Don't show if user dismissed it
    const dismissed = localStorage.getItem('bw5_a2hs_dismissed');
    if (dismissed) return;

    const ua = navigator.userAgent;
    setIsIOS(/iPad|iPhone|iPod/.test(ua));
    setShow(true);
  }, []);

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem('bw5_a2hs_dismissed', '1');
  };

  if (!show) return null;

  return (
    <>
      {/* Small floating pill button — left side, above menu */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.5 }}
        onClick={() => setShowGuide(true)}
        className="fixed bottom-6 left-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full md:hidden"
        style={{
          background: 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
        whileTap={{ scale: 0.95 }}
      >
        <Smartphone size={14} className="text-[#e63946]" />
        <span className="text-[11px] font-bold text-white/90 tracking-wide">ホーム画面に追加</span>
      </motion.button>

      {/* Guide modal */}
      <AnimatePresence>
        {showGuide && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
              onClick={() => setShowGuide(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-x-4 bottom-8 z-[101] max-w-sm mx-auto rounded-3xl overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(30,30,30,0.98) 0%, rgba(15,15,15,0.98) 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <button
                onClick={() => setShowGuide(false)}
                className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"
              >
                <X size={14} className="text-white/70" />
              </button>

              <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-2xl bg-[#e63946]/15 flex items-center justify-center">
                    <Smartphone size={22} className="text-[#e63946]" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white">ホーム画面に追加</h3>
                    <p className="text-[11px] text-[var(--text-muted)]">アプリのように使えます</p>
                  </div>
                </div>

                {isIOS ? (
                  <div className="space-y-3">
                    {/* Step 1 */}
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04]">
                      <div className="w-7 h-7 rounded-full bg-[#e63946]/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-[#e63946]">1</div>
                      <div>
                        <p className="text-xs font-bold text-white">画面下の共有ボタンをタップ</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
                          ← この形のアイコン
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04]">
                      <div className="w-7 h-7 rounded-full bg-[#e63946]/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-[#e63946]">2</div>
                      <div>
                        <p className="text-xs font-bold text-white">「ホーム画面に追加」をタップ</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">下にスクロールすると出てきます</p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04]">
                      <div className="w-7 h-7 rounded-full bg-[#e63946]/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-[#e63946]">3</div>
                      <div>
                        <p className="text-xs font-bold text-white">右上の「追加」をタップ</p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">BOOMくんアイコンがホーム画面に追加されます</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04]">
                      <div className="w-7 h-7 rounded-full bg-[#e63946]/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-[#e63946]">1</div>
                      <div>
                        <p className="text-xs font-bold text-white">ブラウザの「︙」メニューを開く</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04]">
                      <div className="w-7 h-7 rounded-full bg-[#e63946]/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-[#e63946]">2</div>
                      <div>
                        <p className="text-xs font-bold text-white">「ホーム画面に追加」をタップ</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={handleDismiss}
                    className="flex-1 py-3 rounded-xl text-xs font-medium text-[var(--text-muted)] bg-white/5"
                  >
                    表示しない
                  </button>
                  <button
                    onClick={() => setShowGuide(false)}
                    className="flex-1 py-3 rounded-xl text-xs font-bold btn-primary"
                  >
                    OK
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
