"use client";

import { Lock, X } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

interface LockedSectionProps {
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  color: string;
  /** タップ時に表示するプレビュー画像（任意） */
  previewImage?: string;
  /** タップ時のモーダルに出す解禁案内文（任意） */
  unlockMessage?: string;
}

// セクションごとのカスタム情報。propsで渡されない場合のデフォルト。
const SECTION_PREVIEW: Record<string, { previewImage?: string; unlockMessage?: string }> = {
  pamphlet: {
    previewImage: "/pamphlet/page-01.webp",
    unlockMessage: "こちらがデジタルパンフレットの表紙です。中身は 5/5 13:45 開場と同時に解禁します。お楽しみに!",
  },
  schedule: {
    unlockMessage: "演目情報は 5/5 9:00 に解禁します。お楽しみに!",
  },
  vote: {
    unlockMessage: "投票は 5/5 13:45 開場と同時に解禁します。",
  },
};

export default function LockedSection({ id, title, subtitle, emoji, previewImage, unlockMessage }: LockedSectionProps) {
  const meta = SECTION_PREVIEW[id] ?? {};
  const finalPreview = previewImage ?? meta.previewImage;
  const finalMessage = unlockMessage ?? meta.unlockMessage;
  const isClickable = !!(finalPreview || finalMessage);
  const [open, setOpen] = useState(false);

  return (
    <section id={id} className="py-10 px-4 sm:px-6">
      <div className="max-w-md mx-auto">
        <button
          type="button"
          onClick={() => isClickable && setOpen(true)}
          disabled={!isClickable}
          className="relative rounded-2xl p-7 text-center overflow-hidden w-full block transition-transform"
          style={{
            background: "rgba(255,255,255,0.95)",
            border: "1px solid rgba(255,255,255,0.8)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            cursor: isClickable ? "pointer" : "default",
          }}
        >
          <div className="text-3xl mb-2">{emoji}</div>
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-2"
            style={{
              background: "rgba(242,122,26,0.08)",
              border: "1px solid rgba(242,122,26,0.15)",
            }}
          >
            <Lock size={10} style={{ color: "#f27a1a" }} />
            <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: "#f27a1a" }}>
              COMING SOON
            </span>
          </div>
          <h3 className="text-base font-bold mb-0.5" style={{ color: "#333" }}>
            {title}
          </h3>
          <p className="text-[11px]" style={{ color: "#999" }}>
            {subtitle}
          </p>
          {isClickable && (
            <p className="text-[10px] mt-2 font-bold" style={{ color: "#f27a1a" }}>
              タップして詳細を見る
            </p>
          )}
        </button>
      </div>

      {/* タップ時のプレビューモーダル */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              className="relative bg-white rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto"
            >
              <button
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
              >
                <X size={18} />
              </button>
              <div className="p-5 pb-3" style={{ background: "linear-gradient(135deg,#f27a1a,#dc4c04)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Lock size={14} className="text-white" />
                  <span className="text-[11px] font-black tracking-widest text-white/90">COMING SOON</span>
                </div>
                <h3 className="text-lg font-black text-white leading-tight">{title}</h3>
              </div>
              {finalPreview && (
                <div className="relative w-full aspect-[3/4] bg-gray-100">
                  <Image src={finalPreview} alt={title} fill className="object-contain" sizes="(max-width: 768px) 90vw, 400px" />
                </div>
              )}
              <div className="p-5">
                <p className="text-sm text-gray-700 leading-relaxed text-center">{finalMessage}</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
