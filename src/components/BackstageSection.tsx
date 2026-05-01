'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Clock } from 'lucide-react';
import Image from 'next/image';
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

  // Rotate active photo
  useEffect(() => {
    if (!status || status.photos.length === 0) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % status.photos.length);
    }, status.rotate_ms || 4500);
    return () => clearInterval(t);
  }, [status]);

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
              <h2 className="text-base font-black tracking-tight text-white/80">舞台裏ライブフォト</h2>
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
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#22c55e' }} />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: '#22c55e' }} />
            </span>
            <Camera size={16} className="text-white/70" />
            <h2 className="text-base font-black tracking-tight text-white">舞台裏ライブフォト</h2>
          </div>

          <div className="relative w-full" style={{ aspectRatio: '4 / 3', background: '#000' }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={photo.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: 'easeInOut' }}
                className="absolute inset-0"
              >
                <Image
                  src={photo.image_url}
                  alt="backstage"
                  fill
                  sizes="(max-width: 640px) 100vw, 480px"
                  style={{ objectFit: 'cover' }}
                  unoptimized
                  priority={idx === 0}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="px-5 py-2.5 text-[11px] text-white/55 text-center">
            舞台裏の様子を写真でお届け
          </div>
        </motion.div>
      </div>
    </section>
  );
}
