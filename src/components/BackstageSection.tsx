'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { useSwipeable } from 'react-swipeable';
import { getStage, type Stage } from '@/lib/stage';

interface Photo {
  id: number;
  image_url: string;
  caption: string;
  uploaded_at: string;
}
interface Status {
  visible: boolean;
  rotate_ms: number;
  photos: Photo[];
}

export default function BackstageSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<Stage>('pre');
  // 手動操作後は自動切替を一時停止する用
  const lastInteractionRef = useRef<number>(0);

  // Re-evaluate stage every 30s
  useEffect(() => {
    const update = () => setStage(getStage());
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    fetch('/api/backstage')
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  // 自動切替（手動操作後5秒は一時停止）
  useEffect(() => {
    if (!status || status.photos.length === 0) return;
    const t = setInterval(() => {
      const sinceInteraction = Date.now() - lastInteractionRef.current;
      if (sinceInteraction < 5000) return; // 5秒間ユーザー操作優先
      setIdx((i) => (i + 1) % status.photos.length);
    }, status.rotate_ms || 4500);
    return () => clearInterval(t);
  }, [status]);

  const goPrev = useCallback(() => {
    if (!status || status.photos.length === 0) return;
    lastInteractionRef.current = Date.now();
    setIdx((i) => (i - 1 + status.photos.length) % status.photos.length);
  }, [status]);

  const goNext = useCallback(() => {
    if (!status || status.photos.length === 0) return;
    lastInteractionRef.current = Date.now();
    setIdx((i) => (i + 1) % status.photos.length);
  }, [status]);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: goNext,
    onSwipedRight: goPrev,
    trackTouch: true,
    trackMouse: true,
    preventScrollOnSwipe: true,
    delta: 20,
  });

  // ── pre ステージ（〜5/5 09:00）はプレースホルダ表示 ──
  const isComingSoon = stage === 'pre';
  if (isComingSoon) {
    return (
      <section id="backstage" className="py-12 px-4 sm:px-6">
        <div className="max-w-md mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6 }}
            className="rounded-3xl overflow-hidden relative"
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <div className="px-5 pt-4 pb-3 flex items-center gap-2">
              <Camera size={16} className="text-white/40" />
              <h2 className="text-base font-black tracking-tight text-white/80">舞台裏フォトメモリー</h2>
              <span className="ml-auto text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(242,122,26,0.25)', color: '#ffb37a' }}>
                COMING SOON
              </span>
            </div>
            <div className="relative w-full" style={{ aspectRatio: '4 / 3', background: 'linear-gradient(135deg, #1a1a1a 0%, #2a1810 100%)' }}>
              <Image
                src="/images/backstage_coming_soon.png"
                alt="Coming soon"
                fill
                sizes="(max-width: 640px) 100vw, 480px"
                style={{ objectFit: 'contain' }}
                unoptimized
                onError={(e) => {
                  // Fallback if image not yet generated — show BOOMくん
                  const img = e.currentTarget as HTMLImageElement;
                  if (!img.dataset.fallback) {
                    img.dataset.fallback = '1';
                    img.src = '/images/boomkun.png';
                    img.style.objectFit = 'contain';
                  }
                }}
              />
              <div className="absolute bottom-3 left-0 right-0 text-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-md"
                  style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.15)' }}>
                  <Clock size={12} className="text-orange-300" />
                  <span className="text-[11px] font-bold text-white">5/5 9:00 から お届け!</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-2.5 text-[11px] text-white/55 text-center">
              開場後、舞台裏の様子をリアルタイムでお届けします
            </div>
          </motion.div>
        </div>
      </section>
    );
  }

  // ── open 以降：通常のリアルフォト表示 ──
  if (!status || !status.visible || status.photos.length === 0) return null;

  const photo = status.photos[idx % status.photos.length];

  return (
    <section id="backstage" className="py-12 px-4 sm:px-6">
      <div className="max-w-md mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl overflow-hidden relative"
          style={{
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div className="px-5 pt-4 pb-3 flex items-center gap-2">
            <Camera size={16} className="text-white/70" />
            <h2 className="text-base font-black tracking-tight text-white">舞台裏フォトメモリー</h2>
            <span className="ml-auto text-[10px] font-mono text-white/60 tabular-nums">
              {idx + 1} / {status.photos.length}
            </span>
          </div>

          <div
            {...swipeHandlers}
            className="relative w-full select-none"
            style={{
              aspectRatio: '4 / 3',
              background: '#000',
              touchAction: 'pan-y',
            }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={photo.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: 'easeInOut' }}
                className="absolute inset-0"
              >
                <Image
                  src={photo.image_url}
                  alt="backstage"
                  fill
                  sizes="(max-width: 640px) 100vw, 480px"
                  quality={75}
                  style={{ objectFit: 'cover', pointerEvents: 'none' }}
                  priority={idx === 0}
                  draggable={false}
                />
              </motion.div>
            </AnimatePresence>

            {/* 左右ナビボタン */}
            {status.photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="前の写真"
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center transition-opacity"
                  style={{
                    background: 'rgba(0,0,0,0.45)',
                    backdropFilter: 'blur(6px)',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  <ChevronLeft size={18} className="text-white" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="次の写真"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center transition-opacity"
                  style={{
                    background: 'rgba(0,0,0,0.45)',
                    backdropFilter: 'blur(6px)',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  <ChevronRight size={18} className="text-white" />
                </button>
              </>
            )}

            {/* ページインジケーター（ドット） */}
            {status.photos.length > 1 && status.photos.length <= 12 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
                {status.photos.map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: i === idx ? '14px' : '5px',
                      background:
                        i === idx ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)',
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="px-5 py-2.5 text-[11px] text-white/55 text-center">
            スワイプで切替・思い出を振り返ろう
          </div>
        </motion.div>
      </div>
    </section>
  );
}
