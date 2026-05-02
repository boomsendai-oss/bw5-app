"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Clock, ChevronRight, Calendar, ExternalLink } from "lucide-react";
import { timetableData, parseTime, getEndTime } from "@/lib/timetableData";
import { getStage, isUnlockedAtStage, type Stage } from "@/lib/stage";
import Navigation from "@/components/Navigation";
import ScheduleSection from "@/components/ScheduleSection";
import ShopSection from "@/components/ShopSection";
import MusicSection from "@/components/MusicSection";
import VoteSection from "@/components/VoteSection";
import SNSSection from "@/components/SNSSection";
import LockedSection from "@/components/LockedSection";
import Footer from "@/components/Footer";
import WelcomePopup from "@/components/WelcomePopup";
import AddToHomeScreen from "@/components/AddToHomeScreen";
import LotterySection from "@/components/LotterySection";
import BackstageSection from "@/components/BackstageSection";
import PamphletSection from "@/components/PamphletSection";

const SECTION_IDS = [
  "sns",
  "vote",
  "music",
  "merch",
  "schedule",
  "venue",
  "hero",
];

const MENU_ITEMS = [
  {
    id: "schedule",
    emoji: "🗓️",
    label: "演目情報",
    desc: "タイムテーブル / 演目詳細",
    color: "224, 123, 45",
  },
  {
    id: "merch",
    emoji: "🛒",
    label: "ショップ",
    desc: "グッズ・映像販売",
    color: "244, 162, 97",
  },
  {
    id: "music",
    emoji: "🎵",
    label: "オリジナル曲",
    desc: "公表配信中",
    color: "34, 197, 94",
  },
  {
    id: "vote",
    emoji: "⭐",
    label: "投票",
    desc: "お気に入りに投票",
    color: "234, 179, 8",
  },
  {
    id: "sns",
    emoji: "📱",
    label: "SNS",
    desc: "公式アカウント",
    color: "59, 130, 246",
  },
  {
    id: "pamphlet",
    emoji: "📖",
    label: "パンフレット",
    desc: "デジタル版",
    color: "236, 72, 153",
  },
];

// Section visibility config with locked-state metadata
const SECTION_LOCKED_INFO: Record<string, { title: string; subtitle: string; emoji: string; color: string }> = {
  schedule: { title: "演目情報", subtitle: "タイムテーブル・演目詳細", emoji: "🗓️", color: "224, 123, 45" },
  merch:    { title: "グッズ販売", subtitle: "オリジナルグッズの予約・購入", emoji: "🛍️", color: "244, 162, 97" },
  video:    { title: "映像データ", subtitle: "発表会終了後に販売開始予定", emoji: "🎬", color: "168, 85, 247" },
  music:    { title: "音源", subtitle: "オリジナル楽曲を公開予定", emoji: "🎵", color: "34, 197, 94" },
  vote:     { title: "投票", subtitle: "当日にオープンします", emoji: "⭐", color: "234, 179, 8" },
  sns:      { title: "SNS", subtitle: "公式アカウントをフォローしよう", emoji: "📱", color: "59, 130, 246" },
  pamphlet: { title: "デジタルパンフレット", subtitle: "5/5 13:45 開場と同時に解禁", emoji: "📖", color: "236, 72, 153" },
};

// ── Countdown Hook ──
function useCountdown(targetDate: string) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, isOver: false });

  useEffect(() => {
    const target = new Date(targetDate + "T13:45:00+09:00"); // 13:45 JST 開場
    const tick = () => {
      const now = new Date();
      const diff = target.getTime() - now.getTime();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isOver: true });
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
        isOver: false,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return timeLeft;
}

export default function Home() {
  const [activeSection, setActiveSection] = useState("schedule");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [heroImage, setHeroImage] = useState("/images/hero_main.png");
  const [now, setNow] = useState(() => new Date());

  const eventDate = settings.event_date || "2026-05-05";
  const countdown = useCountdown(eventDate);

  // Update current time every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Find current and next performance
  const { currentItem, nextItem } = useMemo(() => {
    let current = null;
    let next = null;
    for (let i = 0; i < timetableData.length; i++) {
      const item = timetableData[i];
      const start = parseTime(item.startTime);
      const end = getEndTime(item);
      if (now >= start && now < end) {
        current = item;
        for (let j = i + 1; j < timetableData.length; j++) {
          if (timetableData[j].type === 'performance' || timetableData[j].type === 'guest' || timetableData[j].type === 'special') {
            next = timetableData[j];
            break;
          }
        }
        break;
      }
    }
    if (!current) {
      for (const item of timetableData) {
        const start = parseTime(item.startTime);
        if (now < start && item.type !== 'break') {
          next = item;
          break;
        }
      }
    }
    return { currentItem: current, nextItem: next };
  }, [now]);

  // Event-day gating: reveal live/coming-up bar only on/after event day 00:00 JST
  const isEventDay = useMemo(() => {
    const [y, m, d] = eventDate.split('-').map(Number);
    // 00:00 JST == previous day 15:00 UTC
    const eventDayStartJst = new Date(Date.UTC(y, m - 1, d, -9, 0, 0));
    return now >= eventDayStartJst;
  }, [now, eventDate]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        if (data.hero_image) setHeroImage(data.hero_image);
      })
      .catch(() => {});
  }, []);

  // Stage gating (re-evaluated every 30s and on URL change)
  const [stage, setStage] = useState<Stage>('pre');
  useEffect(() => {
    const update = () => setStage(getStage());
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, []);

  // Section visibility:
  //   stage が解禁を許可していれば原則公開。
  //   settings の section_X_visible='0' は明示的な強制ロック扱いで stage を上書き。
  //   settings='1' は stage が解禁すべきでない場面でも強制公開（運営テスト用）。
  const isSectionVisible = useCallback((sectionId: string): boolean => {
    const key = `section_${sectionId}_visible`;
    const explicit = settings[key];
    if (explicit === '0' || explicit === 'false') return false;
    if (explicit === '1' || explicit === 'true') return true;
    return isUnlockedAtStage(sectionId, stage);
  }, [settings, stage]);

  // Filter menu items based on visibility
  const visibleMenuItems = useMemo(() => {
    return MENU_ITEMS.map(item => ({
      ...item,
      locked: !isSectionVisible(item.id),
    }));
  }, [isSectionVisible]);

  const handleScroll = useCallback(() => {
    const scrollY = window.scrollY + window.innerHeight / 3;
    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el && el.offsetTop <= scrollY) {
        setActiveSection(id);
        break;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const handleNavigate = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const venueName = settings.venue || "太白区文化センター 楽楽楽ホール";
  const venueAddress = settings.venue_address || "仙台市太白区長町5-3-2";
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueName + " " + venueAddress)}`;

  return (
    <>
      <WelcomePopup />
      <AddToHomeScreen />
      <Navigation
        activeSection={activeSection}
        onNavigate={handleNavigate}
        hiddenSections={MENU_ITEMS.filter(item => !isSectionVisible(item.id)).map(item => item.id)}
      />
      <main className="bg-noise">
        {/* ══════════════════════════════════════════
            HERO — Image + Title + Countdown
        ══════════════════════════════════════════ */}
        <section
          id="hero"
          className="relative flex flex-col items-center overflow-hidden px-4 pt-14 pb-6 min-h-screen"
        >
          {/* Background effects */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/10" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
              backgroundSize: "50px 50px",
            }}
          />

          {/* ── Hero Image + Title ── */}
          <div className="relative z-10 flex flex-col items-center justify-center flex-1 w-full">
            <motion.div
              className="mb-2"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImage}
                alt="BOOM WOP vol.5"
                className="object-contain drop-shadow-[0_8px_30px_rgba(0,0,0,0.3)]"
                style={{
                  width: `${settings.hero_image_size || '200'}px`,
                  height: `${settings.hero_image_size || '200'}px`,
                  maxHeight: '30vh',
                  maxWidth: '30vh',
                }}
              />
            </motion.div>

            <motion.div
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h1 className="text-5xl sm:text-7xl font-black tracking-tighter gradient-text leading-none">
                {settings.hero_title_line1 || "BOOM WOP"}
              </h1>
              <div className="text-5xl sm:text-7xl font-black tracking-tighter gradient-text leading-none mt-1">
                {settings.hero_title_line2 || "vol.5"}
              </div>
              <motion.p
                className="mt-2 text-xs tracking-[0.2em] uppercase text-white/60"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                {settings.hero_subtitle || "Dance Showcase & Entertainment"}
              </motion.p>
            </motion.div>

            {/* ── Countdown ── */}
            <motion.div
              className="mt-6 w-full"
              style={{ maxWidth: "340px" }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
            >
              {(stage === 'pre' || stage === 'morning') && !countdown.isOver ? (
                <div className="rounded-2xl p-4 text-center"
                  style={{
                    background: "rgba(255,255,255,0.12)",
                    backdropFilter: "blur(16px)",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                >
                  <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/60 mb-2">
                    <Calendar size={12} className="inline mr-1 -mt-0.5" />
                    {settings.hero_date || "2026.5.5"} 開催まで
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {[
                      { value: countdown.days, label: "日" },
                      { value: countdown.hours, label: "時間" },
                      { value: countdown.minutes, label: "分" },
                      { value: countdown.seconds, label: "秒" },
                    ].map((unit, i) => (
                      <div key={unit.label} className="flex items-center gap-2">
                        <div className="flex flex-col items-center">
                          <span className="text-3xl sm:text-4xl font-black text-white tabular-nums leading-none">
                            {String(unit.value).padStart(2, "0")}
                          </span>
                          <span className="text-[9px] font-bold text-white/50 mt-1">{unit.label}</span>
                        </div>
                        {i < 3 && (
                          <span className="text-xl font-bold text-white/30 -mt-3">:</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : stage === 'closed' ? (
                /* Closed — 終了メッセージ */
                <div className="rounded-2xl p-4 text-center"
                  style={{
                    background: "rgba(244, 162, 97, 0.15)",
                    border: "1px solid rgba(244, 162, 97, 0.4)",
                    backdropFilter: "blur(16px)",
                  }}
                >
                  <div className="text-2xl mb-1">🎉</div>
                  <div className="text-base font-black text-white">
                    BW5 全演目が終了しました
                  </div>
                  <div className="text-xs text-white/70 mt-1">
                    ご来場いただきありがとうございました
                  </div>
                </div>
              ) : (
                /* Event day — NOW LIVE badge */
                <div className="rounded-2xl p-4 text-center"
                  style={{
                    background: "rgba(34, 197, 94, 0.15)",
                    border: "1px solid rgba(34, 197, 94, 0.3)",
                    backdropFilter: "blur(16px)",
                  }}
                >
                  <div className="flex items-center justify-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                    </span>
                    <span className="text-lg font-black tracking-wider text-green-400">NOW LIVE</span>
                  </div>
                </div>
              )}
            </motion.div>

            {/* ── Now Playing Bar (event day) / Waiting Bar (before) ── */}
            <AnimatePresence mode="wait">
              {stage === 'pre' ? (
                <motion.a
                  key="ticket-bar"
                  href={settings.ticket_url || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full mt-3 block group"
                  style={{ maxWidth: "340px" }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div
                    className="rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-300 group-hover:brightness-110"
                    style={{
                      background: "linear-gradient(135deg, rgba(224,123,45,0.95), rgba(244,162,97,0.95))",
                      border: "1px solid rgba(255,255,255,0.25)",
                      boxShadow: "0 8px 24px rgba(224,123,45,0.35)",
                    }}
                  >
                    <span className="text-xl shrink-0">🎫</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold tracking-wider uppercase text-white/80">TICKET</div>
                      <div className="text-sm font-black text-white truncate">チケット購入はこちら</div>
                    </div>
                    <span className="text-white/90 text-lg shrink-0 transition-transform group-hover:translate-x-0.5">→</span>
                  </div>
                </motion.a>
              ) : stage === 'morning' ? (
                /* 当日朝(9:00〜13:45): 当日券のご案内 */
                <motion.div
                  key="walkup-bar"
                  className="w-full mt-3"
                  style={{ maxWidth: "340px" }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <div
                    className="rounded-xl px-4 py-3 flex items-center gap-3"
                    style={{
                      background: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.18))",
                      border: "1px solid rgba(34,197,94,0.4)",
                      boxShadow: "0 8px 24px rgba(34,197,94,0.2)",
                    }}
                  >
                    <span className="text-xl shrink-0">🎟️</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-bold tracking-wider uppercase text-green-300">WALK-UP TICKET</div>
                      <div className="text-sm font-black text-white leading-tight">当日チケットも販売中 ¥2,500</div>
                      <div className="text-[10px] text-white/70 mt-0.5">申込不要・会場へ直接お越しください</div>
                    </div>
                  </div>
                </motion.div>
              ) : stage !== 'closed' && (currentItem || nextItem) ? (
                <motion.div
                  key="live-bar"
                  className="w-full mt-3"
                  style={{ maxWidth: "340px" }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <div
                    className="rounded-xl px-4 py-2.5 flex items-center gap-3"
                    style={{
                      background: currentItem
                        ? "rgba(34, 197, 94, 0.12)"
                        : "rgba(234, 179, 8, 0.1)",
                      border: currentItem
                        ? "1px solid rgba(34, 197, 94, 0.25)"
                        : "1px solid rgba(234, 179, 8, 0.2)",
                      backdropFilter: "blur(12px)",
                    }}
                  >
                    {currentItem ? (
                      <>
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] font-bold tracking-wider uppercase text-green-400">NOW PLAYING</div>
                          <div className="text-sm font-bold text-white truncate">{currentItem.title}</div>
                        </div>
                        {nextItem && (
                          <div className="text-right shrink-0">
                            <div className="text-[9px] uppercase tracking-wider text-white/40">NEXT</div>
                            <div className="text-[11px] text-white/70 truncate max-w-[80px]">{nextItem.title}</div>
                          </div>
                        )}
                      </>
                    ) : nextItem ? (() => {
                      // 開演前で「次の演目」がまだ始まってない場合 → タイトルを伏せて「?」表示。
                      // タイムテーブルの最初の本番演目と一致するかで判定。
                      const firstShowItem = timetableData.find(
                        (it) => it.type === 'performance' || it.type === 'guest' || it.type === 'special'
                      );
                      const isOpeningTease = firstShowItem && nextItem.startTime === firstShowItem.startTime;
                      return (
                        <>
                          <span className="text-base">⏳</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-bold tracking-wider uppercase text-yellow-400">COMING UP</div>
                            <div className="text-sm font-bold text-white truncate">
                              {isOpeningTease ? "???" : nextItem.title}
                            </div>
                          </div>
                          {/* 「?」の時だけ 14:30 開演時刻を表示。実演目が見えてからは時刻を隠す。 */}
                          {isOpeningTease && (
                            <div className="text-xs text-white/50 shrink-0">14:30〜</div>
                          )}
                        </>
                      );
                    })() : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* ── プレゼント企画 bar (show のときだけ表示。タップでくじ引きへ) ── */}
            {stage === 'show' && (
            <motion.button
              onClick={() => handleNavigate('lottery')}
              className="w-full mt-3 block"
              style={{ maxWidth: "340px" }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              whileTap={{ scale: 0.98 }}
            >
              <div
                className="rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-300 hover:brightness-110 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(236,72,153,0.95), rgba(190,24,93,0.95))",
                  border: "1px solid rgba(255,255,255,0.25)",
                  boxShadow: "0 8px 24px rgba(190,24,93,0.35)",
                }}
              >
                {/* tiny sparkles — fixed positions to avoid hydration mismatch & re-render flicker */}
                <div className="absolute inset-0 pointer-events-none">
                  {[
                    { left: 12, top: 30, dur: 2.6, delay: 0.2 },
                    { left: 38, top: 75, dur: 3.1, delay: 1.1 },
                    { left: 60, top: 20, dur: 2.3, delay: 0.7 },
                    { left: 78, top: 65, dur: 3.4, delay: 1.6 },
                    { left: 90, top: 40, dur: 2.8, delay: 0.4 },
                  ].map((p, i) => (
                    <motion.span
                      key={i}
                      className="absolute text-xs"
                      style={{ left: `${p.left}%`, top: `${p.top}%` }}
                      animate={{ opacity: [0, 1, 0], scale: [0.5, 1.2, 0.5] }}
                      transition={{ duration: p.dur, repeat: Infinity, delay: p.delay }}
                    >
                      ✨
                    </motion.span>
                  ))}
                </div>
                <span className="text-xl shrink-0 relative z-10">🎁</span>
                <div className="flex-1 min-w-0 relative z-10 text-left">
                  <div className="text-[10px] font-bold tracking-wider uppercase text-white/85">PRESENT</div>
                  <div className="text-sm font-black text-white truncate">プレゼント企画</div>
                </div>
                <span className="text-white/90 text-lg shrink-0 relative z-10">→</span>
              </div>
            </motion.button>
            )}

            {/* ── Closing Thank-You card (closed のみ) ── */}
            {stage === 'closed' && (
              <motion.div
                className="w-full mt-3"
                style={{ maxWidth: "340px" }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <div className="relative w-full" style={{ aspectRatio: "16 / 9", background: "rgba(0,0,0,0.3)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={settings.closing_photo_url || "/images/closing_photo.png"}
                      alt="ありがとうございました"
                      className="absolute inset-0 w-full h-full"
                      style={{ objectFit: "cover" }}
                      onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                        const img = e.currentTarget;
                        if (!img.dataset.fb) {
                          img.dataset.fb = "1";
                          img.src = "/images/boomkun.png";
                          img.style.objectFit = "contain";
                          img.style.padding = "16px";
                        }
                      }}
                    />
                  </div>
                  <div className="px-4 py-4 text-center">
                    <p className="text-base font-black text-white mb-1">
                      ご来場いただきありがとうございました!
                    </p>
                    <p className="text-[11px] text-white/65 leading-relaxed">
                      皆さまのおかげで素晴らしい1日になりました。<br />
                      また次回のステージでお会いしましょう 🎉
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* ── Quick Access Cards ── */}
          <motion.div
            className="relative z-10 w-full mt-4 px-1 sm:px-0"
            style={{ maxWidth: "min(380px, calc(100vw - 24px))" }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <div className="grid grid-cols-3 gap-2">
              {visibleMenuItems.map((item, i) => (
                <motion.button
                  key={item.id}
                  onClick={() => !item.locked && handleNavigate(item.id)}
                  className="group relative flex flex-col items-center justify-center rounded-2xl py-3.5 px-2 transition-all duration-300 overflow-hidden"
                  style={{
                    background: item.locked
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(255,255,255,0.13)",
                    border: item.locked
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px solid rgba(255,255,255,0.2)",
                    backdropFilter: "blur(12px)",
                    opacity: item.locked ? 0.5 : 1,
                  }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: item.locked ? 0.5 : 1, scale: 1 }}
                  transition={{
                    duration: 0.4,
                    delay: 0.4 + i * 0.06,
                    type: "spring",
                    stiffness: 200,
                  }}
                  whileTap={item.locked ? {} : { scale: 0.92 }}
                  whileHover={item.locked ? {} : {
                    background: "rgba(255,255,255,0.22)",
                    borderColor: "rgba(255,255,255,0.35)",
                  }}
                >
                  <span className="text-2xl mb-1">
                    {item.locked ? "🔒" : item.emoji}
                  </span>
                  <span className="text-[11px] font-bold text-white leading-tight text-center">
                    {item.label}
                  </span>
                  {!item.locked && (
                    <span className="text-[8px] text-white/50 mt-0.5 leading-tight text-center">
                      {item.desc}
                    </span>
                  )}
                  {item.locked && (
                    <span className="text-[8px] text-white/30 mt-0.5">Coming Soon</span>
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>

          {/* Scroll hint */}
          <motion.div
            className="relative z-10 mt-4 flex flex-col items-center gap-0.5"
            animate={{ opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/30">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </motion.div>
        </section>

        {/* ══════════════════════════════════════════
            BACKSTAGE LIVE (上部に配置 — 一回スクロールで見える位置)
            stage 解禁 + admin の section_backstage_visible 強制ロックの両方に従う
        ══════════════════════════════════════════ */}
        {isSectionVisible('backstage') && <BackstageSection />}

        {/* ══════════════════════════════════════════
            VENUE INFO (open ステージ以降は非表示。pre/morning でのみ表示)
        ══════════════════════════════════════════ */}
        {(stage === 'pre' || stage === 'morning') && (
        <section id="venue" className="py-10 px-4 sm:px-6">
          <div className="max-w-md mx-auto">
            <motion.div
              className="rounded-2xl overflow-hidden shadow-lg"
              style={{
                background: "rgba(255,255,255,0.95)",
                border: "1px solid rgba(255,255,255,0.6)",
              }}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6 }}
            >
              {/* Header */}
              <div className="px-5 pt-5 pb-2">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "#f27a1a" }}
                  >
                    <MapPin size={16} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold" style={{ color: "#333" }}>会場情報</h3>
                    <p className="text-[10px] tracking-wider uppercase" style={{ color: "#999" }}>Venue</p>
                  </div>
                </div>
              </div>

              {/* Venue details */}
              <div className="px-5 pb-5 space-y-3">
                <div>
                  <p className="text-base font-bold leading-snug" style={{ color: "#222" }}>{venueName}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#888" }}>{venueAddress}</p>
                </div>

                <div className="flex items-center gap-4 text-xs" style={{ color: "#666" }}>
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} />
                    <span>開場 {settings.open_time || "13:45"} / 開演 {settings.start_time || "14:30"}</span>
                  </div>
                </div>

                {/* Google Maps link */}
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between w-full px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90"
                  style={{
                    background: "#f27a1a",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <MapPin size={15} />
                    <span>Google Maps で開く</span>
                  </div>
                  <ExternalLink size={14} className="text-white/70" />
                </a>
              </div>
            </motion.div>
          </div>
        </section>
        )}

        {/* ── Sections (visibility-controlled) ── */}
        <div className="section-divider" />
        {isSectionVisible('schedule') ? <ScheduleSection /> : <LockedSection id="schedule" {...SECTION_LOCKED_INFO.schedule} />}
        <div className="section-divider" />
        {isSectionVisible('pamphlet') ? <PamphletSection /> : <LockedSection id="pamphlet" {...SECTION_LOCKED_INFO.pamphlet} />}
        <div className="section-divider" />
        {(isSectionVisible('merch') || isSectionVisible('video')) ? (
          <ShopSection />
        ) : (
          <LockedSection id="merch" {...SECTION_LOCKED_INFO.merch} />
        )}
        <div className="section-divider" />
        {isSectionVisible('music') ? <MusicSection /> : <LockedSection id="music" {...SECTION_LOCKED_INFO.music} />}
        <div className="section-divider" />
        {(stage === 'show' || stage === 'open') && <LotterySection />}
        <div className="section-divider" />
        {isSectionVisible('vote') ? <VoteSection /> : <LockedSection id="vote" {...SECTION_LOCKED_INFO.vote} />}
        <div className="section-divider" />
        {isSectionVisible('sns') ? <SNSSection /> : <LockedSection id="sns" {...SECTION_LOCKED_INFO.sns} />}
        <Footer />
      </main>
    </>
  );
}
