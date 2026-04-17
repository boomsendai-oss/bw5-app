'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Clock, Play, ChevronRight, Film, Mic, Coffee } from 'lucide-react';
import Link from 'next/link';
import {
  timetableData,
  parseTime,
  getEndTime,
  PARTS,
  type TimetableItem,
} from '@/lib/timetableData';

// ─── Helpers ────────────────────────────────────────────────────
function formatTime(date: Date): string {
  return date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

function formatTimeFromStr(t: string): string {
  return formatTime(parseTime(t));
}

function getItemStatus(
  item: TimetableItem,
  now: Date
): 'past' | 'current' | 'next' | 'upcoming' {
  const start = parseTime(item.startTime);
  const end = getEndTime(item);
  if (now >= start && now < end) return 'current';
  if (now >= end) return 'past';
  return 'upcoming';
}

function getTypeIcon(type: TimetableItem['type']) {
  switch (type) {
    case 'performance': return Play;
    case 'video': return Film;
    case 'mc': return Mic;
    case 'break': return Coffee;
  }
}

function getTypeLabel(type: TimetableItem['type']) {
  switch (type) {
    case 'performance': return 'STAGE';
    case 'video': return 'VIDEO';
    case 'mc': return 'MC';
    case 'break': return 'BREAK';
  }
}

// ─── Main Component ─────────────────────────────────────────────
export default function TimetablePage() {
  const [now, setNow] = useState(() => new Date());
  const [activePart, setActivePart] = useState<1 | 2 | 3>(1);
  const currentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Tick every 30s
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Derive current/next
  const currentItem = useMemo(
    () => timetableData.find((item) => getItemStatus(item, now) === 'current') ?? null,
    [now]
  );

  const nextItem = useMemo(() => {
    if (!currentItem) {
      // Before event or in a gap — find next upcoming
      return timetableData.find((item) => parseTime(item.startTime) > now) ?? null;
    }
    const idx = timetableData.indexOf(currentItem);
    return idx < timetableData.length - 1 ? timetableData[idx + 1] : null;
  }, [currentItem, now]);

  // Auto-select active part based on current time
  useEffect(() => {
    if (currentItem) {
      setActivePart(currentItem.part);
    } else if (nextItem) {
      setActivePart(nextItem.part);
    }
  }, [currentItem, nextItem]);

  // Auto-scroll to current item
  const scrollToCurrent = useCallback(() => {
    if (currentRef.current) {
      currentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(scrollToCurrent, 400);
    return () => clearTimeout(t);
  }, [activePart, scrollToCurrent]);

  // Overall progress
  const overallProgress = useMemo(() => {
    const first = parseTime(timetableData[0].startTime);
    const lastItem = timetableData[timetableData.length - 1];
    const last = getEndTime(lastItem);
    const total = last.getTime() - first.getTime();
    if (total <= 0) return 0;
    const elapsed = now.getTime() - first.getTime();
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  }, [now]);

  // Current item progress (for the glow ring)
  const currentProgress = useMemo(() => {
    if (!currentItem) return 0;
    const start = parseTime(currentItem.startTime);
    const end = getEndTime(currentItem);
    const total = end.getTime() - start.getTime();
    if (total <= 0) return 0;
    const elapsed = now.getTime() - start.getTime();
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  }, [currentItem, now]);

  // Countdown before event
  const showCountdown = useMemo(() => {
    const first = parseTime(timetableData[0].startTime);
    return now < first;
  }, [now]);

  const countdownMinutes = useMemo(() => {
    if (!showCountdown) return 0;
    const first = parseTime(timetableData[0].startTime);
    return Math.ceil((first.getTime() - now.getTime()) / 60_000);
  }, [showCountdown, now]);

  // Items filtered by active part
  const filteredItems = useMemo(
    () => timetableData.filter((item) => item.part === activePart),
    [activePart]
  );

  // Event finished?
  const eventFinished = useMemo(() => {
    const lastItem = timetableData[timetableData.length - 1];
    return now >= getEndTime(lastItem);
  }, [now]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] bg-noise text-white">
      {/* Header */}
      <header className="sticky top-0 z-30 glass-strong border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-xl tracking-wider">STAGE TIMELINE</h1>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <Clock size={12} />
            <span className="tabular-nums">{formatTime(now)}</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-24">
        {/* Countdown Banner */}
        <AnimatePresence>
          {showCountdown && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mt-4 rounded-2xl p-6 text-center"
              style={{
                background: 'linear-gradient(135deg, rgba(45,106,79,0.3) 0%, rgba(212,168,83,0.15) 100%)',
                border: '1px solid rgba(45,106,79,0.4)',
              }}
            >
              <p className="text-sm text-[#7fcea0] font-medium tracking-widest uppercase mb-1">開演まで</p>
              <p className="font-display text-5xl text-white tracking-wider">
                {countdownMinutes}<span className="text-2xl text-white/60 ml-1">min</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Event Finished Banner */}
        <AnimatePresence>
          {eventFinished && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 rounded-2xl p-6 text-center"
              style={{
                background: 'linear-gradient(135deg, rgba(212,168,83,0.2) 0%, rgba(45,106,79,0.15) 100%)',
                border: '1px solid rgba(212,168,83,0.3)',
              }}
            >
              <p className="font-display text-3xl gradient-gold tracking-wider">THANK YOU!</p>
              <p className="text-sm text-white/50 mt-1">全演目が終了しました</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* NOW PLAYING Card */}
        <AnimatePresence>
          {currentItem && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mt-4 rounded-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(45,106,79,0.25) 0%, rgba(45,106,79,0.08) 100%)',
                border: '1px solid rgba(45,106,79,0.5)',
                boxShadow: '0 0 40px rgba(45,106,79,0.2), 0 0 80px rgba(45,106,79,0.08)',
              }}
            >
              {/* Progress bar at top */}
              <div className="h-1 bg-white/5">
                <motion.div
                  className="h-full rounded-r-full"
                  style={{ background: 'linear-gradient(90deg, #2d6a4f, #7fcea0)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${currentProgress}%` }}
                  transition={{ duration: 1, ease: 'linear' }}
                />
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2d6a4f] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#7fcea0]" />
                  </span>
                  <span className="text-xs font-bold tracking-[0.2em] uppercase text-[#7fcea0]">Now Playing</span>
                  <span className="ml-auto text-xs text-white/40 tabular-nums">
                    {formatTimeFromStr(currentItem.startTime)}
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-display text-3xl text-white/20 leading-none mt-0.5">{currentItem.id}</span>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-white truncate">{currentItem.title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full bg-[#2d6a4f]/30 text-[#7fcea0]">
                        {getTypeLabel(currentItem.type)}
                      </span>
                      <span className="text-xs text-white/40">
                        {Math.floor(currentItem.durationSec / 60)}:{String(currentItem.durationSec % 60).padStart(2, '0')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* NEXT Card */}
        <AnimatePresence>
          {nextItem && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-3 rounded-xl p-4 flex items-center gap-3"
              style={{
                background: 'rgba(212,168,83,0.08)',
                border: '1px solid rgba(212,168,83,0.2)',
              }}
            >
              <ChevronRight size={16} className="text-[#d4a853] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#d4a853] mb-0.5">Next</p>
                <p className="text-sm font-semibold text-white truncate">{nextItem.title}</p>
              </div>
              <span className="text-xs text-white/40 tabular-nums shrink-0">
                {formatTimeFromStr(nextItem.startTime)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Overall Progress */}
        {!showCountdown && !eventFinished && (
          <div className="mt-5 px-1">
            <div className="flex items-center justify-between text-xs text-white/40 mb-1.5">
              <span>全体進行</span>
              <span className="tabular-nums">{Math.round(overallProgress)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #2d6a4f, #d4a853)' }}
                animate={{ width: `${overallProgress}%` }}
                transition={{ duration: 1 }}
              />
            </div>
          </div>
        )}

        {/* Part Tabs */}
        <div className="flex gap-2 mt-6 mb-4">
          {PARTS.map((p) => {
            const isActive = activePart === p.part;
            return (
              <button
                key={p.part}
                onClick={() => setActivePart(p.part)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all ${
                  isActive
                    ? 'bg-[#2d6a4f]/20 text-[#7fcea0] border border-[#2d6a4f]/40'
                    : 'bg-white/3 text-white/40 border border-white/5 hover:text-white/60'
                }`}
              >
                {p.label}
                <span className="block text-[10px] font-normal text-white/30 mt-0.5">
                  {formatTimeFromStr(p.startTime)}〜
                </span>
              </button>
            );
          })}
        </div>

        {/* Timeline List */}
        <div ref={listRef} className="space-y-1.5">
          {filteredItems.map((item, idx) => {
            const status = getItemStatus(item, now);
            const isCurrent = status === 'current';
            const isPast = status === 'past';
            const Icon = getTypeIcon(item.type);

            return (
              <motion.div
                key={item.id}
                ref={isCurrent ? currentRef : undefined}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className={`relative rounded-xl px-4 py-3 flex items-center gap-3 transition-all ${
                  isCurrent
                    ? 'bg-[#2d6a4f]/15 border border-[#2d6a4f]/40'
                    : isPast
                    ? 'bg-white/[0.02] border border-white/[0.03] opacity-40'
                    : 'bg-white/[0.02] border border-white/[0.05]'
                }`}
                style={
                  isCurrent
                    ? { boxShadow: '0 0 20px rgba(45,106,79,0.15)' }
                    : undefined
                }
              >
                {/* Timeline dot */}
                <div className="flex flex-col items-center shrink-0 w-8">
                  <div
                    className={`w-3 h-3 rounded-full border-2 ${
                      isCurrent
                        ? 'bg-[#7fcea0] border-[#2d6a4f] shadow-[0_0_8px_rgba(45,106,79,0.6)]'
                        : isPast
                        ? 'bg-white/20 border-white/10'
                        : 'bg-transparent border-white/15'
                    }`}
                  />
                </div>

                {/* Time */}
                <span className="text-xs tabular-nums text-white/40 w-12 shrink-0">
                  {formatTimeFromStr(item.startTime)}
                </span>

                {/* Icon */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    isCurrent
                      ? 'bg-[#2d6a4f]/30 text-[#7fcea0]'
                      : 'bg-white/5 text-white/30'
                  }`}
                >
                  <Icon size={14} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-semibold truncate ${
                      isCurrent ? 'text-white' : isPast ? 'text-white/50' : 'text-white/80'
                    }`}
                  >
                    {item.title}
                  </p>
                  <p className="text-[10px] text-white/30 mt-0.5">
                    {Math.floor(item.durationSec / 60)}:{String(item.durationSec % 60).padStart(2, '0')}
                  </p>
                </div>

                {/* Status badge */}
                {isCurrent && (
                  <span className="text-[10px] font-bold tracking-widest uppercase text-[#7fcea0] shrink-0">
                    LIVE
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      </main>

      {/* Floating "Go to NOW" button */}
      {currentItem && currentItem.part === activePart && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={scrollToCurrent}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, #2d6a4f 0%, #1a4031 100%)',
            border: '1px solid rgba(127,206,160,0.3)',
            boxShadow: '0 8px 30px rgba(45,106,79,0.4)',
          }}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7fcea0] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#7fcea0]" />
          </span>
          <span className="text-xs font-bold text-[#7fcea0] tracking-wider">NOW</span>
        </motion.button>
      )}
    </div>
  );
}
