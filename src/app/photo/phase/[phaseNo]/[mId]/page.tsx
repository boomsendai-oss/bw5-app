"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useSearchParams, notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ExternalLink,
  Download,
  X,
  Hourglass,
} from "lucide-react";
import {
  PHOTO_PHASES,
  isPhaseReleased,
  getPerformanceMeta,
} from "@/lib/photoPhases";
import {
  getPhotoManifest,
  thumbUrl,
  previewUrl,
  type PhotoFile,
} from "@/lib/photoManifests";

// ─────────────────────────────────────────────────────────────
// /photo/phase/[phaseNo]/[mId] — 演目別ギャラリー
// ─────────────────────────────────────────────────────────────

function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function PerformanceGalleryPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const preview = searchParams.get("preview") === "1";
  const phaseNo = Number(params.phaseNo);
  const mId = String(params.mId);

  const phase = useMemo(
    () => PHOTO_PHASES.find((p) => p.phaseNo === phaseNo),
    [phaseNo]
  );
  const item = useMemo(
    () => phase?.items.find((i) => i.mId === mId),
    [phase, mId]
  );

  const now = useNow();
  const meta = getPerformanceMeta(mId);
  const manifest = getPhotoManifest(mId);

  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (!phase || !item) {
    notFound();
  }

  const released = preview || isPhaseReleased(phase, now);
  const photos: PhotoFile[] = manifest ?? [];

  return (
    <main className="min-h-screen pb-12" style={{ background: "#fff7ed" }}>
      {/* ─── Header ─── */}
      <header
        className="sticky top-0 z-30 px-4 pt-3 pb-3"
        style={{
          background: "#fff7ed",
          borderBottom: "1px solid #fde4cd",
        }}
      >
        <Link
          href={`/photo/phase/${phaseNo}${preview ? "?preview=1" : ""}`}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#dc4c04] mb-2"
        >
          <ArrowLeft size={14} /> Phase {phaseNo} へ戻る
        </Link>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-black text-gray-900 leading-tight truncate">
              {meta.title}
            </h1>
            {meta.subtitle && (
              <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                {meta.subtitle}
              </p>
            )}
          </div>
          <div className="text-[10px] font-bold tracking-wider uppercase text-[#dc4c04] shrink-0">
            {photos.length} 枚
          </div>
        </div>
      </header>

      {/* ─── 未公開ガード ─── */}
      {!released && (
        <div className="px-4 py-6">
          <div
            className="rounded-2xl px-4 py-4 text-center"
            style={{ background: "#fff", border: "2px dashed #f27a1a" }}
          >
            <Hourglass size={24} className="mx-auto mb-1.5 text-[#dc4c04]" />
            <div className="text-sm font-black text-gray-900">
              このPhaseは {phase.releaseDate} 0:00 公開予定
            </div>
          </div>
        </div>
      )}

      {/* ─── サムネグリッド ─── */}
      {released && photos.length > 0 && (
        <div className="px-2 pt-3">
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((p, i) => (
              <motion.button
                key={p.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.4) }}
                onClick={() => setActiveIdx(i)}
                className="relative aspect-square overflow-hidden rounded-lg bg-gray-200 active:scale-[0.97] transition-transform"
              >
                <Image
                  src={thumbUrl(p.id, 400)}
                  alt={p.name}
                  fill
                  sizes="(max-width: 768px) 33vw, 200px"
                  unoptimized
                  style={{ objectFit: "cover" }}
                />
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {released && photos.length === 0 && (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          写真準備中です。
        </div>
      )}

      {/* ─── 下部 CTA: Drive で全部見る ─── */}
      {released && photos.length > 0 && item.driveUrl && (
        <div className="px-4 pt-6">
          <a
            href={item.driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-2xl px-4 py-3.5 text-center font-bold text-sm active:scale-[0.98] transition-transform"
            style={{
              background:
                "linear-gradient(135deg, #f27a1a 0%, #dc4c04 100%)",
              color: "#fff",
              boxShadow: "0 6px 18px rgba(220,76,4,0.28)",
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              Driveで全部見る・一括DL
              <ExternalLink size={14} />
            </span>
          </a>
          <p className="text-[10px] text-gray-500 text-center mt-2 leading-relaxed">
            上のサムネをタップすると拡大表示・1枚ずつDLできます
          </p>
        </div>
      )}

      {/* ─── Lightbox ─── */}
      <AnimatePresence>
        {activeIdx !== null && photos[activeIdx] && (
          <Lightbox
            photos={photos}
            idx={activeIdx}
            onClose={() => setActiveIdx(null)}
            onChange={setActiveIdx}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// Lightbox（拡大表示 + DL）
// ─────────────────────────────────────────────────────────────
function Lightbox({
  photos,
  idx,
  onClose,
  onChange,
}: {
  photos: PhotoFile[];
  idx: number;
  onClose: () => void;
  onChange: (i: number) => void;
}) {
  const p = photos[idx];
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && idx > 0) onChange(idx - 1);
      if (e.key === "ArrowRight" && idx < photos.length - 1)
        onChange(idx + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, photos.length, onClose, onChange]);

  // 写真Appに保存 (iOS) / ダウンロード (PC) — 共有シート優先
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/photo/${p.id}`);
      const blob = await res.blob();
      const file = new File([blob], p.name, {
        type: blob.type || "image/jpeg",
      });

      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: { files: File[]; title?: string }) => Promise<void>;
      };

      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: p.name });
      } else {
        // フォールバック: 通常DL
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = p.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error("保存に失敗", e);
      // 最後の手段: 直接 API URL を新規タブで開く
      window.open(`/api/photo/${p.id}`, "_blank");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs opacity-70">
          {idx + 1} / {photos.length}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs font-bold bg-white text-[#dc4c04] hover:bg-white/90 rounded-full px-3.5 py-1.5 disabled:opacity-60"
          >
            <Download size={14} />
            {saving ? "保存中…" : "写真に保存"}
          </button>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white"
            aria-label="閉じる"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Image */}
      <div
        className="flex-1 flex items-center justify-center px-2 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* prev */}
        {idx > 0 && (
          <button
            onClick={() => onChange(idx - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl px-3 py-6"
            aria-label="前へ"
          >
            ‹
          </button>
        )}

        <Image
          src={previewUrl(p.id, 1600)}
          alt={p.name}
          width={1600}
          height={1066}
          unoptimized
          style={{
            maxHeight: "85vh",
            width: "auto",
            height: "auto",
            objectFit: "contain",
          }}
        />

        {/* next */}
        {idx < photos.length - 1 && (
          <button
            onClick={() => onChange(idx + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl px-3 py-6"
            aria-label="次へ"
          >
            ›
          </button>
        )}
      </div>

      {/* Bottom hint */}
      <div className="px-4 py-3 text-center text-[10px] text-white/60 leading-relaxed">
        iPhoneなら「写真に保存」→ 共有メニュー →「画像を保存」で写真Appへ
        <br />
        <span className="text-white/40">
          画像長押し→「写真に追加」でも保存できます
        </span>
      </div>
    </motion.div>
  );
}
