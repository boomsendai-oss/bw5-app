"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Users, Music, User, Disc3, Camera, ChevronLeft, ChevronRight, CalendarClock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { PARTS, timetableData, REGULAR_SCHEDULE } from "@/lib/timetableData";

interface Performance {
  m_id: string;
  title: string;
  title_reading: string;
  instructor: string;
  performer_count: number;
  genre: string;
  song_name: string;
  part: number;
  profile?: string;
  guest_from?: string;
  guest_image_url?: string;
}

interface Performer {
  name: string;
  sort_order: number;
}

const PART_COLORS: Record<number, string> = {
  1: "#f27a1a",
  2: "#60a5fa",
  3: "#a78bfa",
};

// M_IDs that have a cutout group photo at /performances/{id}.webp.
// Guest spots (M11/M21/M23/M34/M36) have no photo.
const GROUP_PHOTO_IDS = new Set([
  "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10",
  "M14", "M15", "M16", "M17", "M19", "M20", "M22", "M24",
  "M27", "M28", "M29", "M30", "M31", "M33", "M35", "M37",
]);


export default function PerformanceDetailPage() {
  const params = useParams();
  const mId = params.mId as string;
  const [perf, setPerf] = useState<Performance | null>(null);
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [loading, setLoading] = useState(true);
  const [photoAspect, setPhotoAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!mId) return;
    Promise.all([
      fetch(`/api/performances?m_id=${mId}`).then((r) => r.json()),
      fetch(`/api/performers?m_id=${mId}`).then((r) => r.json()),
    ])
      .then(([perfData, perfList]) => {
        setPerf(perfData);
        setPerformers(perfList);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [mId]);

  const partInfo = PARTS.find((p) => p.part === perf?.part);
  const partColor = PART_COLORS[perf?.part || 1] || "#999";

  // Per-part display sequence number (No.1, No.2, ...) — same logic as TIMETABLE section.
  // Counts performance / guest / special, ignores breaks.
  const partSeq = (() => {
    if (!perf) return null;
    const list = timetableData.filter(
      (i) => i.part === perf.part && (i.type === "performance" || i.type === "guest" || i.type === "special")
    );
    const idx = list.findIndex((i) => i.id === perf.m_id);
    return idx >= 0 ? idx + 1 : null;
  })();

  // Prev / Next: walk all show items across all parts in order
  const { prevItem, nextItem } = (() => {
    if (!perf) return { prevItem: null, nextItem: null };
    const all = timetableData.filter(
      (i) => i.type === "performance" || i.type === "guest" || i.type === "special"
    );
    const idx = all.findIndex((i) => i.id === perf.m_id);
    return {
      prevItem: idx > 0 ? all[idx - 1] : null,
      nextItem: idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null,
    };
  })();

  // Persist part to sessionStorage so returning to schedule keeps the tab
  useEffect(() => {
    if (perf?.part) {
      sessionStorage.setItem("bw5_active_part", String(perf.part));
    }
  }, [perf?.part]);

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #f27a1a 0%, #e85d04 50%, #dc4c04 100%)" }}
      >
        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!perf) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: "linear-gradient(135deg, #f27a1a 0%, #e85d04 50%, #dc4c04 100%)" }}
      >
        <p className="text-white/70 text-sm mb-4">演目が見つかりません</p>
        <Link href="/#schedule" className="text-white/50 text-xs underline">
          タイムテーブルに戻る
        </Link>
      </div>
    );
  }

  // Group photo exists only for class numbers (not guest spots). File is /public/performances/{M_ID}.webp.
  // Use a known set to avoid onError flicker. Keep in sync with public/performances/.
  const hasGroupPhoto = GROUP_PHOTO_IDS.has(perf.m_id);
  const groupPhotoSrc = `/performances/${perf.m_id}.webp`;

  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(135deg, #f27a1a 0%, #e85d04 50%, #dc4c04 100%)",
      }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-30 px-4 py-3 flex items-center gap-3"
        style={{
          background: "rgba(220, 100, 10, 0.85)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <Link href="/#schedule" className="p-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }}>
          <ArrowLeft size={18} className="text-white" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white leading-tight line-clamp-2">{perf.title}</h1>
        </div>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0"
          style={{ background: partColor }}
        >
          {partInfo?.label}
        </span>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto space-y-4">
        {/* Prev / Next navigation (top — easy access) */}
        <div className="grid grid-cols-2 gap-2">
          {prevItem ? (
            <Link
              href={`/performance/${prevItem.id}`}
              className="flex items-center gap-2 rounded-2xl px-3 py-2.5 transition-all active:scale-[0.98]"
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.22)",
                backdropFilter: "blur(8px)",
              }}
            >
              <ChevronLeft size={18} className="text-white shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-bold tracking-widest uppercase text-white/60">前の演目</div>
                <div className="text-xs font-bold text-white truncate">{prevItem.title}</div>
              </div>
            </Link>
          ) : (
            <div className="rounded-2xl px-3 py-2.5 opacity-30" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="text-[9px] font-bold tracking-widest uppercase text-white/40">前の演目</div>
              <div className="text-xs text-white/50">—</div>
            </div>
          )}
          {nextItem ? (
            <Link
              href={`/performance/${nextItem.id}`}
              className="flex items-center gap-2 rounded-2xl px-3 py-2.5 transition-all active:scale-[0.98] text-right"
              style={{
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.22)",
                backdropFilter: "blur(8px)",
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-bold tracking-widest uppercase text-white/60">次の演目</div>
                <div className="text-xs font-bold text-white truncate">{nextItem.title}</div>
              </div>
              <ChevronRight size={18} className="text-white shrink-0" />
            </Link>
          ) : (
            <div className="rounded-2xl px-3 py-2.5 opacity-30 text-right" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="text-[9px] font-bold tracking-widest uppercase text-white/40">次の演目</div>
              <div className="text-xs text-white/50">—</div>
            </div>
          )}
        </div>

        {/* Performance Hero Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="rounded-2xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.95)",
            boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
          }}
        >
          <div className="px-5 pt-5 pb-4">
            {/* Title area */}
            <div className="flex items-start gap-3 mb-4">
              {partSeq != null ? (
                <div
                  className="w-16 h-14 rounded-xl flex flex-col items-center justify-center shrink-0"
                  style={{ background: `${partColor}15`, border: `1px solid ${partColor}30` }}
                >
                  <span
                    className="text-[8px] font-bold tracking-widest uppercase leading-none"
                    style={{ color: partColor, opacity: 0.85 }}
                  >
                    No.
                  </span>
                  <span
                    className="text-xl font-black tabular-nums leading-none mt-0.5"
                    style={{ color: partColor }}
                  >
                    {perf.part}-{partSeq}
                  </span>
                </div>
              ) : (
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `${partColor}15`, border: `1px solid ${partColor}30` }}
                >
                  <Music size={22} style={{ color: partColor }} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2
                  className="font-black leading-tight break-words"
                  style={{
                    color: "#222",
                    fontSize: perf.title.length > 14 ? "1.05rem" : "1.25rem",
                  }}
                >
                  {perf.title}
                </h2>
                {perf.title_reading && (
                  <p className="text-[11px] mt-0.5" style={{ color: "#999" }}>
                    {perf.title_reading}
                  </p>
                )}
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Part */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f5f5f5" }}>
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: partColor }}
                >
                  {perf.part}
                </div>
                <div>
                  <div className="text-xs font-bold" style={{ color: "#333" }}>
                    {partInfo?.label}
                  </div>
                  <div className="text-[9px]" style={{ color: "#999" }}>
                    {partInfo?.startTime}〜
                  </div>
                </div>
              </div>

              {/* Instructor */}
              {perf.instructor && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f5f5f5" }}>
                  <User size={14} style={{ color: "#888" }} />
                  <div>
                    <div className="text-xs font-bold" style={{ color: "#333" }}>
                      {perf.instructor}
                    </div>
                    <div className="text-[9px]" style={{ color: "#999" }}>Instructor</div>
                  </div>
                </div>
              )}

              {/* Genre — hidden for guests / ダンス部 / special numbers (those aren't class-based) */}
              {perf.genre &&
                perf.genre !== 'GUEST' &&
                !perf.genre.includes('ダンス部') &&
                !perf.genre.includes('SPECIAL') && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f5f5f5" }}>
                  <Disc3 size={14} style={{ color: "#888" }} />
                  <div>
                    <div className="text-xs font-bold" style={{ color: "#333" }}>
                      {perf.genre}
                    </div>
                    <div className="text-[9px]" style={{ color: "#999" }}>クラス</div>
                  </div>
                </div>
              )}

              {/* 通常レッスンの曜日・時間 (該当あるナンバーのみ) */}
              {REGULAR_SCHEDULE[perf.m_id] && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl col-span-2" style={{ background: "#fff7ed", border: "1px solid rgba(242,122,26,0.25)" }}>
                  <CalendarClock size={14} style={{ color: "#dc4c04" }} />
                  <div>
                    <div className="text-xs font-bold" style={{ color: "#333" }}>
                      {REGULAR_SCHEDULE[perf.m_id]}
                    </div>
                    <div className="text-[9px]" style={{ color: "#999" }}>通常レッスン</div>
                  </div>
                </div>
              )}
            </div>

            {/* Song name */}
            {perf.song_name && (
              <div
                className="mt-3 flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: "#f5f5f5" }}
              >
                <Music size={14} style={{ color: "#888" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: "#999" }}>
                    Song
                  </div>
                  <div className="text-xs font-bold truncate" style={{ color: "#333" }}>
                    {perf.song_name}
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Guest Profile (shown for guest performances) */}
        {perf.profile && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.95)",
              boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
            }}
          >
            {perf.guest_image_url && (
              <div
                className="relative w-full"
                style={{
                  aspectRatio: "4 / 3",
                  background: "linear-gradient(180deg, rgba(242,122,26,0.12) 0%, rgba(242,122,26,0.04) 100%)",
                }}
              >
                <Image
                  src={perf.guest_image_url}
                  alt={`${perf.title}`}
                  fill
                  sizes="(max-width: 640px) 100vw, 512px"
                  style={{ objectFit: "cover" }}
                  priority={false}
                />
              </div>
            )}
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                {(() => {
                  const item = timetableData.find((i) => i.id === perf.m_id);
                  const isSpecial = item?.type === 'special';
                  return (
                    <span
                      className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full"
                      style={{
                        background: isSpecial ? "rgba(236, 72, 153, 0.12)" : "rgba(242,122,26,0.12)",
                        color: isSpecial ? "#ec4899" : "#f27a1a",
                      }}
                    >
                      {isSpecial ? "SPECIAL ナンバー" : "GUEST DANCER"}
                    </span>
                  );
                })()}
                {perf.guest_from && (
                  <span className="text-[11px]" style={{ color: "#888" }}>from {perf.guest_from}</span>
                )}
              </div>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: "#333" }}>
                {perf.profile}
              </p>
            </div>
          </motion.div>
        )}

        {/* Group Photo */}
        {hasGroupPhoto && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.95)",
              boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
            }}
          >
            <div className="px-4 pt-3 pb-2 flex items-center gap-2">
              <Camera size={14} style={{ color: "#f27a1a" }} />
              <h3 className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "#888" }}>
                {partSeq != null ? `No.${perf.part}-${partSeq}  Class Photo` : "Class Photo"}
              </h3>
            </div>
            <div
              className="relative w-full"
              style={{
                // Match the photo's own aspect ratio once loaded, so the image
                // fills the container edge-to-edge without crop or whitespace.
                aspectRatio: photoAspect ? `${photoAspect}` : "4 / 3",
                background: "linear-gradient(180deg, rgba(242,122,26,0.12) 0%, rgba(242,122,26,0.04) 100%)",
                transition: "aspect-ratio 0.2s ease",
              }}
            >
              <Image
                src={groupPhotoSrc}
                alt={`${perf.title} 集合写真`}
                fill
                sizes="(max-width: 640px) 100vw, 512px"
                style={{ objectFit: "contain" }}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setPhotoAspect(img.naturalWidth / img.naturalHeight);
                  }
                }}
                priority={false}
              />
            </div>
          </motion.div>
        )}

        {/* Performers List */}
        {performers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.95)",
              boxShadow: "0 4px 15px rgba(0,0,0,0.1)",
            }}
          >
            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={16} style={{ color: "#f27a1a" }} />
                <h3 className="text-sm font-bold" style={{ color: "#333" }}>
                  出演者
                </h3>
              </div>
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(242,122,26,0.1)", color: "#f27a1a" }}
              >
                {performers.length}名
              </span>
            </div>

            <div className="px-4 pb-4">
              <div className="grid grid-cols-2 gap-1.5">
                {performers.map((p, i) => {
                  // Auto-shrink font for long names so they fit on small screens
                  const len = p.name.length;
                  const fontSize =
                    len >= 9 ? '0.625rem' :
                    len >= 7 ? '0.7rem' :
                    '0.75rem';
                  return (
                    <motion.div
                      key={`${p.name}-${i}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: 0.15 + i * 0.02 }}
                      className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg"
                      style={{ background: "#f8f8f8" }}
                    >
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: partColor }}
                      >
                        {p.sort_order}
                      </div>
                      <span
                        className="font-medium leading-tight break-all"
                        style={{ color: "#333", fontSize }}
                      >
                        {p.name}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {/* Back link */}
        <div className="text-center pt-2">
          <Link
            href="/#schedule"
            className="text-[11px] text-white/50 hover:text-white/80 transition-colors"
          >
            ← タイムテーブルに戻る
          </Link>
        </div>
      </main>
    </div>
  );
}
