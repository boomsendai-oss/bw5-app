'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Clock, Play, ChevronRight, Star, Sparkles, Coffee, Search } from 'lucide-react';
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
    case 'guest':       return Star;
    case 'special':     return Sparkles;
    case 'break':       return Coffee;
  }
}

function getTypeLabel(type: TimetableItem['type']) {
  switch (type) {
    case 'performance': return 'STAGE';
    case 'guest':       return 'GUEST';
    case 'special':     return 'SPECIAL';
    case 'break':       return 'BREAK';
  }
}

// Accent color per type — used for non-current icon tint to avoid clashing with the orange bg
function getTypeAccent(type: TimetableItem['type']): string {
  switch (type) {
    case 'performance': return '#60a5fa';
    case 'guest':       return '#fbbf24';
    case 'special':     return '#ec4899';
    case 'break':       return '#4ade80';
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

  // Current item progress
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
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'rgba(220, 100, 10, 0.85)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-xl tracking-wider">STAGE TIMELINE</h1>
          </div>
          <Link
            href="/search"
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold text-white/70 hover:text-white transition-colors"
            style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <Search size={12} />
            検索
          </Link>
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
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.25)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <p className="text-sm text-white/80 font-medium tracking-widest uppercase mb-1">開演まで</p>
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
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <p className="font-display text-3xl gradient-text tracking-wider">THANK YOU!</p>
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
                background: 'rgba(255,255,255,0.95)',
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 4px 30px rgba(0,0,0,0.15)',
              }}
            >
              {/* Progress bar at top */}
              <div className="h-1 bg-gray-100">
                <motion.div
                  className="h-full rounded-r-full"
                  style={{ background: 'linear-gradient(90deg, #f27a1a, #f5a623)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${currentProgress}%` }}
                  transition={{ duration: 1, ease: 'linear' }}
                />
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                  </span>
                  <span className="text-xs font-bold tracking-[0.2em] uppercase" style={{ color: '#22c55e' }}>Now Playing</span>
                  <span className="ml-auto text-xs tabular-nums" style={{ color: '#999' }}>
                    {formatTimeFromStr(currentItem.startTime)}
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="font-display text-3xl leading-none mt-0.5" style={{ color: '#ddd' }}>{currentItem.id}</span>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold truncate" style={{ color: '#222' }}>{currentItem.title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(242,122,26,0.1)', color: '#f27a1a' }}
                      >
                        {getTypeLabel(currentItem.type)}
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
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <ChevronRight size={16} className="text-white/70 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/50 mb-0.5">Next</p>
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
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #f27a1a, #f5a623)' }}
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
                className="flex-1 py-2.5 rounded-xl text-sm font-bold tracking-wider transition-all"
                style={{
                  background: isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.08)',
                  border: isActive ? '1px solid rgba(255,255,255,0.8)' : '1px solid rgba(255,255,255,0.12)',
                  color: isActive ? '#f27a1a' : 'rgba(255,255,255,0.5)',
                }}
              >
                {p.label}
                <span className="block text-[10px] font-normal mt-0.5"
                  style={{ color: isActive ? '#c46010' : 'rgba(255,255,255,0.3)' }}
                >
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

            const isPerformance = item.type === 'performance' || item.type === 'guest' || item.type === 'special';
            const accent = getTypeAccent(item.type);

            return (
              <div
                key={item.id}
                ref={isCurrent ? currentRef : undefined}
                className={`relative rounded-xl px-4 py-3 flex items-center gap-3 transition-all ${isPerformance ? 'cursor-pointer active:scale-[0.98]' : ''}`}
                style={{
                  background: isCurrent
                    ? 'rgba(255,255,255,0.95)'
                    : isPast
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(255,255,255,0.15)',
                  border: isCurrent
                    ? '1px solid rgba(255,255,255,0.8)'
                    : '1px solid rgba(255,255,255,0.12)',
                  boxShadow: isCurrent ? '0 4px 20px rgba(0,0,0,0.12)' : 'none',
                  opacity: isPast ? 0.5 : 1,
                }}
                onClick={isPerformance ? () => window.location.href = `/performance/${item.id}` : undefined}
              >
                {/* Timeline dot */}
                <div className="flex flex-col items-center shrink-0 w-8">
                  <div
                    className="w-3 h-3 rounded-full border-2"
                    style={{
                      background: isCurrent ? '#f27a1a' : isPast ? 'rgba(255,255,255,0.2)' : 'transparent',
                      borderColor: isCurrent ? '#e06d10' : isPast ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.15)',
                      boxShadow: isCurrent ? '0 0 8px rgba(242,122,26,0.6)' : 'none',
                    }}
                  />
                </div>

                {/* Time */}
                <span className="text-xs tabular-nums w-12 shrink-0"
                  style={{ color: isCurrent ? '#f27a1a' : 'rgba(255,255,255,0.4)' }}
                >
                  {formatTimeFromStr(item.startTime)}
                </span>

                {/* Icon */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: isCurrent ? `${accent}1f` : `${accent}22`,
                    color: isCurrent ? accent : accent,
                  }}
                >
                  <Icon size={14} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p
                      className="text-sm font-bold truncate"
                      style={{
                        color: isCurrent ? '#222' : isPast ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.9)',
                      }}
                    >
                      {item.title}
                    </p>
                    {item.type === 'guest' && (
                      <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded shrink-0" style={{ background: '#fbbf24', color: '#1a1a1a' }}>
                        GUEST
                      </span>
                    )}
                    {item.type === 'special' && (
                      <span className="text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded shrink-0" style={{ background: '#ec4899', color: '#fff' }}>
                        SPECIAL
                      </span>
                    )}
                  </div>
                  {item.subtitle && item.type !== 'guest' && (
                    <p className="text-[10px] mt-0.5 truncate"
                      style={{ color: isCurrent ? '#666' : isPast ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.55)' }}
                    >
                      {item.subtitle}
                    </p>
                  )}
                </div>

                {/* Status badge */}
                {isCurrent && (
                  <span className="text-[10px] font-bold tracking-widest uppercase shrink-0 px-2 py-0.5 rounded-full"
                    style={{ background: '#22c55e', color: '#fff' }}
                  >
                    LIVE
                  </span>
                )}
                {isPerformance && !isCurrent && (
                  <ChevronRight size={14} style={{ color: 'rgba(255,255,255,0.2)' }} className="shrink-0" />
                )}
              </div>
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
            background: '#f27a1a',
            border: '1px solid rgba(255,255,255,0.3)',
            boxShadow: '0 8px 30px rgba(242,122,26,0.4)',
          }}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
          <span className="text-xs font-bold text-white tracking-wider">NOW</span>
        </motion.button>
      )}
    </div>
  );
}
