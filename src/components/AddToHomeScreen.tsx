'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Smartphone } from 'lucide-react';

export default function AddToHomeScreen() {
  const [show, setShow] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    if (isStandalone) return;

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
      {/* Banner above bottom tab bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2 }}
        className="fixed left-0 right-0 z-40 px-3 md:hidden"
        style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}
      >
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
          style={{
            background: 'rgba(255,255,255,0.95)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          }}
        >
          <Smartphone size={16} style={{ color: '#f27a1a' }} className="shrink-0" />
          <button
            onClick={() => setShowGuide(true)}
            className="flex-1 text-left"
          >
            <span className="text-[11px] font-bold" style={{ color: '#333' }}>ホーム画面に追加</span>
          </button>
          <button onClick={handleDismiss} className="shrink-0 p-1">
            <X size={14} style={{ color: '#aaa' }} />
          </button>
        </div>
      </motion.div>

      {/* Guide modal */}
      <AnimatePresence>
        {showGuide && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
              onClick={() => setShowGuide(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-x-4 bottom-8 z-[101] max-w-sm mx-auto rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.97)' }}
            >
              <button
                onClick={() => setShowGuide(false)}
                className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/5 flex items-center justify-center"
              >
                <X size={14} style={{ color: '#999' }} />
              </button>

              <div className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(242,122,26,0.1)' }}>
                    <Smartphone size={20} style={{ color: '#f27a1a' }} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black" style={{ color: '#333' }}>ホーム画面に追加</h3>
                    <p className="text-[10px]" style={{ color: '#999' }}>アプリのように使えます</p>
                  </div>
                </div>

                {isIOS ? (
                  <div className="space-y-2">
                    {[
                      { step: '1', title: '画面下の共有ボタンをタップ', desc: '□に↑のアイコン' },
                      { step: '2', title: '「ホーム画面に追加」をタップ', desc: '下にスクロールすると出てきます' },
                      { step: '3', title: '右上の「追加」をタップ', desc: '' },
                    ].map((s) => (
                      <div key={s.step} className="flex items-start gap-2.5 p-2.5 rounded-lg" style={{ background: '#f5f5f5' }}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white" style={{ background: '#f27a1a' }}>{s.step}</div>
                        <div>
                          <p className="text-[11px] font-bold" style={{ color: '#333' }}>{s.title}</p>
                          {s.desc && <p className="text-[9px] mt-0.5" style={{ color: '#999' }}>{s.desc}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[
                      { step: '1', title: 'ブラウザの「︙」メニューを開く' },
                      { step: '2', title: '「ホーム画面に追加」をタップ' },
                    ].map((s) => (
                      <div key={s.step} className="flex items-start gap-2.5 p-2.5 rounded-lg" style={{ background: '#f5f5f5' }}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white" style={{ background: '#f27a1a' }}>{s.step}</div>
                        <p className="text-[11px] font-bold" style={{ color: '#333' }}>{s.title}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleDismiss}
                    className="flex-1 py-2.5 rounded-xl text-[11px] font-medium"
                    style={{ background: '#f0f0f0', color: '#999' }}
                  >
                    表示しない
                  </button>
                  <button
                    onClick={() => setShowGuide(false)}
                    className="flex-1 py-2.5 rounded-xl text-[11px] font-bold text-white"
                    style={{ background: '#f27a1a' }}
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
