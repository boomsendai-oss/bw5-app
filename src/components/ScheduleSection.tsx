"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Music, Coffee, Star, Sparkles, ChevronRight } from "lucide-react";
import Link from "next/link";
import { timetableData, PARTS, parseTime, getEndTime, type TimetableItem } from "@/lib/timetableData";

const TYPE_CONFIG: Record<TimetableItem['type'], { icon: typeof Music; color: string; label: string }> = {
  performance: { icon: Music,    color: "#60a5fa", label: "演目" },
  guest:       { icon: Star,     color: "#fbbf24", label: "GUEST" },
  special:     { icon: Sparkles, color: "#ec4899", label: "SPECIAL" },
  break:       { icon: Coffee,   color: "#4ade80", label: "休憩" },
};

export default function ScheduleSection() {
  const [activePart, setActivePart] = useState<1 | 2 | 3>(1);
  const [now, setNow] = useState(() => new Date());
  const sectionRef = useRef(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" });

  // Restore last viewed part on mount (so returning from /performance/[mId] keeps the tab)
  useEffect(() => {
    const stored = sessionStorage.getItem("bw5_active_part");
    if (stored && ["1", "2", "3"].includes(stored)) {
      setActivePart(Number(stored) as 1 | 2 | 3);
    }
  }, []);

  // Persist on change
  useEffect(() => {
    sessionStorage.setItem("bw5_active_part", String(activePart));
  }, [activePart]);

  // Tick every 30s for "now playing" highlight
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Items filtered by active part.
  // Hide breaks from the public view — they're operational info, not part of the show.
  // Attach a per-part display sequence number (1, 2, 3…) only for performance-like items.
  const partItems = useMemo(() => {
    const raw = timetableData.filter(
      (item) => item.part === activePart && item.type !== "break"
    );
    let seq = 0;
    return raw.map((item) => {
      const isShow = item.type === "performance" || item.type === "guest" || item.type === "special";
      if (isShow) seq++;
      return { ...item, seq: isShow ? seq : null };
    });
  }, [activePart]);

  // Current playing item ID
  const currentId = useMemo(() => {
    for (const item of timetableData) {
      const start = parseTime(item.startTime);
      const end = getEndTime(item);
      if (now >= start && now < end) return item.id;
    }
    return null;
  }, [now]);

  // Part stats
  const partStats = useMemo(() => {
    return PARTS.map((p) => {
      const items = timetableData.filter((i) => i.part === p.part);
      const performances = items.filter((i) => i.type === "performance" || i.type === "guest" || i.type === "special").length;
      return { ...p, performances, total: items.length };
    });
  }, []);

  return (
    <section id="schedule" className="py-16 px-4 sm:px-6">
      <div className="max-w-lg mx-auto" ref={sectionRef}>
        {/* Section header */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-3">
            TIMETABLE
          </h2>
        </motion.div>

        {/* Part tabs */}
        <motion.div
          className="flex gap-2 mb-6"
          initial={{ opacity: 0, y: 10 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          {partStats.map((p) => {
            const isActive = activePart === p.part;
            return (
              <button
                key={p.part}
                onClick={() => setActivePart(p.part)}
                className="flex-1 relative rounded-xl py-3 px-2 text-center transition-all duration-300 overflow-hidden"
                style={{
                  background: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.1)",
                  border: isActive ? "1px solid rgba(255,255,255,0.8)" : "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <div
                  className="text-base font-black"
                  style={{ color: isActive ? "#f27a1a" : "rgba(255,255,255,0.8)" }}
                >
                  {p.label}
                </div>
                <div
                  className="text-[10px] font-bold mt-0.5"
                  style={{ color: isActive ? "#c46010" : "rgba(255,255,255,0.4)" }}
                >
                  {p.startTime}〜 / {p.performances}演目
                </div>
              </button>
            );
          })}
        </motion.div>

        {/* Item list */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activePart}
            className="space-y-2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {partItems.map((item, i) => {
              const isCurrent = currentId === item.id;
              const cfg = TYPE_CONFIG[item.type];
              const Icon = cfg.icon;
              const isPerformance = item.type === "performance" || item.type === "guest" || item.type === "special";

              const cardClass = `flex items-center gap-3 rounded-xl px-3.5 py-3 transition-all ${isPerformance ? "cursor-pointer active:scale-[0.98]" : ""}`;
              const cardStyle = {
                background: isCurrent
                  ? "rgba(255,255,255,0.95)"
                  : isPerformance
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(255,255,255,0.05)",
                border: isCurrent
                  ? "1px solid rgba(255,255,255,0.8)"
                  : "1px solid rgba(255,255,255,0.08)",
                boxShadow: isCurrent ? "0 4px 20px rgba(0,0,0,0.15)" : "none",
              };

              const inner = (
                <motion.div
                  className={cardClass}
                  style={cardStyle}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                  {/* Sequence number (part-seq, e.g. 1-3) */}
                  <div className="w-[42px] shrink-0 flex flex-col items-center">
                    {item.seq != null ? (
                      <>
                        <span
                          className="text-[8px] font-bold tracking-widest uppercase leading-none mb-0.5"
                          style={{ color: isCurrent ? "#f27a1a" : "rgba(255,255,255,0.35)" }}
                        >
                          No.
                        </span>
                        <span
                          className="text-lg font-black tabular-nums leading-none"
                          style={{ color: isCurrent ? "#f27a1a" : "#fff" }}
                        >
                          {item.part}-{item.seq}
                        </span>
                      </>
                    ) : null}
                  </div>

                  {/* Type indicator */}
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: isCurrent ? cfg.color : `${cfg.color}22`,
                    }}
                  >
                    <Icon
                      size={14}
                      style={{ color: isCurrent ? "#fff" : cfg.color }}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isCurrent && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#22c55e" }} />
                          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#22c55e" }} />
                        </span>
                      )}
                      <span
                        className={`text-sm font-bold truncate ${isCurrent ? "" : ""}`}
                        style={{ color: isCurrent ? "#222" : "#fff" }}
                      >
                        {item.title}
                      </span>
                      {item.type === "guest" && (
                        <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded" style={{ background: "#fbbf24", color: "#1a1a1a" }}>
                          GUEST
                        </span>
                      )}
                      {item.type === "special" && (
                        <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded" style={{ background: "#ec4899", color: "#fff" }}>
                          SPECIAL
                        </span>
                      )}
                    </div>
                    {item.subtitle && item.type !== "guest" && (
                      <div
                        className="text-[10px] font-medium mt-0.5 truncate"
                        style={{ color: isCurrent ? "#666" : "rgba(255,255,255,0.55)" }}
                      >
                        {item.subtitle}
                      </div>
                    )}
                  </div>

                  {/* Now playing badge or arrow */}
                  {isCurrent ? (
                    <span className="text-[9px] font-black tracking-wider uppercase px-2 py-0.5 rounded-full"
                      style={{ background: "#22c55e", color: "#fff" }}
                    >
                      NOW
                    </span>
                  ) : isPerformance ? (
                    <ChevronRight size={14} style={{ color: "rgba(255,255,255,0.2)" }} />
                  ) : null}
                </motion.div>
              );

              return isPerformance ? (
                <Link key={item.id} href={`/performance/${item.id}`} className="block">
                  {inner}
                </Link>
              ) : (
                <div key={item.id}>{inner}</div>
              );
            })}
          </motion.div>
        </AnimatePresence>

        {/* Part timing summary */}
        <motion.div
          className="mt-6 text-center"
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 0.5 }}
        >
          <p className="text-[10px] text-white/40 tracking-wider">
            全{timetableData.filter((i) => i.type === "performance" || i.type === "guest" || i.type === "special").length}演目 / 3部構成 / 14:30〜18:15
          </p>
        </motion.div>
      </div>
    </section>
  );
}
