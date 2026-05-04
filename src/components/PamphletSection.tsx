'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSwipeable } from 'react-swipeable';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { BookOpen, ChevronLeft, ChevronRight, Lock, X } from 'lucide-react';
import Image from 'next/image';

const TOTAL_PAGES = 16;
const UNLOCK_HOUR = 13;
const UNLOCK_MIN = 45;
const EVENT_DATE = '2026-05-05';

// Image native aspect (page width / height)
const IMG_W = 1500;
const IMG_H = 2077;
const IMG_ASPECT = IMG_W / IMG_H;

function useUnlocked(): { unlocked: boolean; remainingMs: number; loading: boolean } {
  const [now, setNow] = useState(() => Date.now());
  const [override, setOverride] = useState<boolean | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => setOverride(s.pamphlet_unlocked === '1'))
      .catch(() => setOverride(false));
  }, []);

  const [y, m, d] = EVENT_DATE.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, UNLOCK_HOUR - 9, UNLOCK_MIN, 0);
  const remainingMs = target - now;
  const timeUnlocked = remainingMs <= 0;

  return {
    unlocked: override === true || timeUnlocked,
    remainingMs,
    loading: override === null,
  };
}

export default function PamphletSection() {
  const { unlocked, remainingMs, loading } = useUnlocked();
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <section id="pamphlet" className="py-12 px-4 sm:px-6">
      <div className="max-w-md mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          className="rounded-3xl overflow-hidden relative"
          style={{
            background: 'linear-gradient(135deg, rgba(242,122,26,0.16), rgba(220,76,4,0.10))',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <div className="px-5 py-6 text-center">
            <div className="inline-flex w-14 h-14 rounded-full items-center justify-center mb-3"
                 style={{ background: 'rgba(242,122,26,0.25)' }}>
              <BookOpen size={26} className="text-orange-200" />
            </div>
            <h2 className="text-xl font-black tracking-tight text-white mb-1">
              デジタルパンフレット
            </h2>
            <p className="text-[11px] text-white/60 mb-5 leading-relaxed">
              全16ページ・スワイプでページめくり<br />
              紙のパンフレットがそのまま読めます
            </p>

            {loading ? (
              <div className="text-xs text-white/40">読み込み中...</div>
            ) : !unlocked ? (
              <LockedView remainingMs={remainingMs} />
            ) : (
              <button
                onClick={() => setViewerOpen(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-black text-sm transition-all active:scale-[0.97]"
                style={{
                  background: 'linear-gradient(135deg, #f27a1a 0%, #dc4c04 100%)',
                  color: '#fff',
                  boxShadow: '0 6px 18px rgba(220,76,4,0.4)',
                }}
              >
                <BookOpen size={16} />
                パンフレットを見る
              </button>
            )}
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {viewerOpen && unlocked && (
          <PamphletViewer onClose={() => setViewerOpen(false)} />
        )}
      </AnimatePresence>
    </section>
  );
}

function PamphletViewer({ onClose }: { onClose: () => void }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [size, setSize] = useState({ w: 360, h: 498 });
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomMode, setZoomMode] = useState(false);

  // Compute viewer size — preserve image aspect (1500:2077)
  useEffect(() => {
    const compute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight - 130; // leave room for top/bottom controls
      // Try fitting by width first, then check height
      let w = Math.min(vw - 24, 600);
      let h = w / IMG_ASPECT;
      if (h > vh) {
        h = vh;
        w = h * IMG_ASPECT;
      }
      setSize({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const next = useCallback(() => {
    if (isZoomed) return;
    setDirection(1);
    setPageIndex((i) => Math.min(TOTAL_PAGES - 1, i + 1));
  }, [isZoomed]);
  const prev = useCallback(() => {
    if (isZoomed) return;
    setDirection(-1);
    setPageIndex((i) => Math.max(0, i - 1));
  }, [isZoomed]);

  // ページ切り替え時にズーム状態をリセット
  useEffect(() => { setIsZoomed(false); setZoomMode(false); }, [pageIndex]);

  // Keyboard arrows
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [next, prev, onClose]);

  // Swipe handlers — ズーム中は無効化
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => !isZoomed && next(),
    onSwipedRight: () => !isZoomed && prev(),
    trackTouch: true,
    trackMouse: true,
    preventScrollOnSwipe: true,
    delta: 15,
  });

  return (
    <motion.div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(12px)', touchAction: 'pan-y' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="text-xs text-white/70 tabular-nums font-bold">
            {pageIndex + 1} / {TOTAL_PAGES}
          </div>
          <div className="text-[10px] text-white/40">
            {zoomMode ? '🔍 拡大中（× で戻る）' : '左右スワイプでページ送り'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoomMode((v) => !v)}
            className="px-3 h-9 rounded-full flex items-center gap-1 text-xs font-bold text-white"
            style={{ background: zoomMode ? 'rgba(220,76,4,0.85)' : 'rgba(255,255,255,0.15)' }}
            aria-label="拡大表示の切り替え"
          >
            {zoomMode ? '✕ 拡大終了' : '🔍 拡大'}
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            aria-label="閉じる"
          >
            <X size={18} className="text-white" />
          </button>
        </div>
      </div>

      {/* Swipe area + page with paper-flip animation */}
      <div
        {...swipeHandlers}
        style={{
          width: size.w,
          height: size.h,
          touchAction: 'pan-y',
          perspective: '1500px',
        }}
        className="relative select-none"
      >
        <AnimatePresence custom={direction} initial={false} mode="wait">
          <motion.div
            key={pageIndex}
            custom={direction}
            initial={{
              rotateY: direction > 0 ? 80 : -80,
              opacity: 0.4,
              x: direction > 0 ? '20%' : '-20%',
            }}
            animate={{ rotateY: 0, opacity: 1, x: 0 }}
            exit={{
              rotateY: direction > 0 ? -80 : 80,
              opacity: 0,
              x: direction > 0 ? '-20%' : '20%',
            }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0.4, 1] }}
            className="absolute inset-0 rounded-md shadow-2xl overflow-hidden"
            style={{
              background: '#fff',
              transformStyle: 'preserve-3d',
              transformOrigin: direction > 0 ? 'left center' : 'right center',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {zoomMode ? (
              <TransformWrapper
                initialScale={1}
                minScale={1}
                maxScale={4}
                doubleClick={{ mode: 'toggle', step: 1.8 }}
                wheel={{ step: 0.2 }}
                pinch={{ step: 5 }}
                onTransform={(_ref: unknown, state: { scale: number }) => setIsZoomed(state.scale > 1.05)}
                centerOnInit
              >
                <TransformComponent
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: '100%', height: '100%' }}
                >
                  <div className="relative w-full h-full">
                    <Image
                      src={`/pamphlet/page-${String(pageIndex + 1).padStart(2, '0')}.webp`}
                      alt={`パンフ ${pageIndex + 1}ページ`}
                      fill
                      sizes="(max-width: 600px) 100vw, 600px"
                      style={{ objectFit: 'cover' }}
                      priority={pageIndex < 2}
                      draggable={false}
                    />
                  </div>
                </TransformComponent>
              </TransformWrapper>
            ) : (
              <div className="relative w-full h-full">
                <Image
                  src={`/pamphlet/page-${String(pageIndex + 1).padStart(2, '0')}.webp`}
                  alt={`パンフ ${pageIndex + 1}ページ`}
                  fill
                  sizes="(max-width: 600px) 100vw, 600px"
                  style={{ objectFit: 'cover' }}
                  priority={pageIndex < 2}
                  draggable={false}
                />
              </div>
            )}
            {/* Page edge gradient (subtle paper depth effect) — ズーム中は非表示 */}
            {!isZoomed && (
              <div
                className="absolute inset-y-0 pointer-events-none"
                style={{
                  left: direction > 0 ? 0 : 'auto',
                  right: direction > 0 ? 'auto' : 0,
                  width: '6%',
                  background: direction > 0
                    ? 'linear-gradient(to right, rgba(0,0,0,0.18), transparent)'
                    : 'linear-gradient(to left, rgba(0,0,0,0.18), transparent)',
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 px-6 py-4 flex items-center justify-between z-10">
        <button
          onClick={prev}
          disabled={pageIndex === 0}
          className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-25 transition-transform active:scale-90"
          style={{ background: 'rgba(255,255,255,0.18)' }}
          aria-label="前のページ"
        >
          <ChevronLeft size={22} className="text-white" />
        </button>
        <div className="text-[10px] text-white/50 text-center leading-tight">
          ← スワイプ →<br />
          <span className="text-white/30">tap でも操作可</span>
        </div>
        <button
          onClick={next}
          disabled={pageIndex >= TOTAL_PAGES - 1}
          className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-25 transition-transform active:scale-90"
          style={{ background: 'rgba(255,255,255,0.18)' }}
          aria-label="次のページ"
        >
          <ChevronRight size={22} className="text-white" />
        </button>
      </div>
    </motion.div>
  );
}

function LockedView({ remainingMs }: { remainingMs: number }) {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);

  return (
    <div className="rounded-2xl py-6 px-4 text-center"
         style={{ background: 'rgba(0,0,0,0.25)', border: '1px dashed rgba(255,255,255,0.2)' }}>
      <Lock size={20} className="text-orange-300 inline mb-2" />
      <h3 className="text-sm font-bold text-white mb-2">本番当日 13:45 解禁</h3>
      {remainingMs > 0 && (
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold"
             style={{ background: 'rgba(0,0,0,0.4)', color: '#fff' }}>
          {days > 0 && <span>{days}日</span>}
          <span className="tabular-nums">{hours}時間</span>
          <span className="tabular-nums">{minutes}分</span>
          <span className="text-white/50">あと</span>
        </div>
      )}
    </div>
  );
}
