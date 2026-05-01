'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera } from 'lucide-react';
import Image from 'next/image';

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

  const load = useCallback(() => {
    fetch('/api/backstage')
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // refresh photo list every 30s
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
          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#22c55e' }} />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: '#22c55e' }} />
            </span>
            <Camera size={16} className="text-white/70" />
            <h2 className="text-base font-black tracking-tight text-white">舞台裏ライブフォト</h2>
          </div>

          {/* Photo with fade */}
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
                {/* キャプションはスタッフ用メモなのでお客さん側には非表示 */}
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
