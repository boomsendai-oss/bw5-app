"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Clock, Radio } from "lucide-react";
import Link from "next/link";

interface ScheduleItem {
  id: number;
  time: string;
  title: string;
  description: string;
}

export default function ScheduleSection() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    fetch("/api/schedule")
      .then((r) => r.json())
      .then((data) => setItems(data))
      .catch(() => {});
  }, []);

  return (
    <section id="schedule" className="py-20 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto" ref={ref}>
        {/* Section title */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-2">
            TIMETABLE
          </h2>
          <div className="section-divider max-w-[200px] mx-auto mb-4" />
          <Link
            href="/timetable"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold tracking-wider transition-all hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, rgba(45,106,79,0.3) 0%, rgba(45,106,79,0.15) 100%)',
              border: '1px solid rgba(45,106,79,0.4)',
              color: '#7fcea0',
              boxShadow: '0 0 20px rgba(45,106,79,0.2)',
            }}
          >
            <Radio size={14} className="animate-pulse" />
            LIVE 舞台進行を見る
          </Link>
        </motion.div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[52px] sm:left-[68px] top-0 bottom-0 w-px bg-gradient-to-b from-[var(--accent-primary)]/50 via-[var(--accent-secondary)]/30 to-transparent" />

          {items.map((item, i) => (
            <motion.div
              key={item.id}
              className="relative flex gap-4 sm:gap-6 mb-6 last:mb-0"
              initial={{ opacity: 0, x: -30 }}
              animate={isInView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              {/* Time */}
              <div className="flex-shrink-0 w-[44px] sm:w-[56px] text-right">
                <span className="text-sm sm:text-base font-mono font-bold text-[var(--accent-secondary)]">
                  {item.time}
                </span>
              </div>

              {/* Dot */}
              <div className="flex-shrink-0 relative z-10 mt-1.5">
                <div className="w-3 h-3 rounded-full bg-[var(--accent-primary)] shadow-[0_0_10px_rgba(230,57,70,0.5)]" />
              </div>

              {/* Card */}
              <div className="flex-1 card p-4 -mt-1">
                <h3 className="font-bold text-white text-sm sm:text-base">
                  {item.title}
                </h3>
                {item.description && (
                  <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
                    {item.description}
                  </p>
                )}
              </div>
            </motion.div>
          ))}

          {items.length === 0 && (
            <div className="text-center py-12 text-[var(--text-muted)]">
              <Clock className="mx-auto mb-3 opacity-50" size={32} />
              <p className="text-sm">タイムテーブル準備中...</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
