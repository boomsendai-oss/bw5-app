"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import Navigation from "@/components/Navigation";
import ScheduleSection from "@/components/ScheduleSection";
import MerchSection from "@/components/MerchSection";
import MusicSection from "@/components/MusicSection";
import VideoSection from "@/components/VideoSection";
import VoteSection from "@/components/VoteSection";
import SNSSection from "@/components/SNSSection";
import Footer from "@/components/Footer";
import WelcomePopup from "@/components/WelcomePopup";
import AddToHomeScreen from "@/components/AddToHomeScreen";

const SECTION_IDS = [
  "sns",
  "vote",
  "video",
  "music",
  "merch",
  "schedule",
  "hero",
];

const MENU_ITEMS = [
  {
    id: "schedule",
    emoji: "🗓️",
    label: "タイムテーブル",
    color: "230, 57, 70",
  },
  {
    id: "merch",
    emoji: "🛍️",
    label: "グッズ",
    color: "244, 162, 97",
  },
  {
    id: "video",
    emoji: "🎬",
    label: "映像データ",
    color: "168, 85, 247",
  },
  {
    id: "music",
    emoji: "🎵",
    label: "音源",
    color: "34, 197, 94",
  },
  {
    id: "vote",
    emoji: "⭐",
    label: "投票",
    color: "234, 179, 8",
  },
  {
    id: "sns",
    emoji: "📱",
    label: "SNS",
    color: "59, 130, 246",
  },
];

export default function Home() {
  const [activeSection, setActiveSection] = useState("schedule");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [heroImage, setHeroImage] = useState("/images/upload_1776286511201.png");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        if (data.hero_image) setHeroImage(data.hero_image);
      })
      .catch(() => {});
  }, []);

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

  return (
    <>
      <WelcomePopup />
      <AddToHomeScreen />
      <Navigation
        activeSection={activeSection}
        onNavigate={handleNavigate}
      />
      <main className="bg-noise">
        {/* ══ Combined Hero + Icon Grid (single first-view screen) ══ */}
        <section
          id="hero"
          className="relative min-h-[100dvh] flex flex-col items-center justify-between overflow-hidden px-4 pt-16 pb-6"
        >
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent-primary)]/10 via-transparent to-transparent" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
              backgroundSize: "50px 50px",
            }}
          />

          {/* ── Top: Hero Image (background) + Title (foreground) ── */}
          <div className="relative z-10 flex-1 flex flex-col items-center justify-center w-full">
            {/* Floating hero image behind text */}
            <motion.div
              className="absolute inset-0 flex items-start justify-center pointer-events-none pt-4"
              animate={{ y: [0, -12, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImage}
                alt="BOOM WOP vol.5"
                className="object-contain drop-shadow-[0_0_40px_rgba(230,57,70,0.4)]"
                style={{
                  width: `${settings.hero_image_size || '220'}px`,
                  height: `${settings.hero_image_size || '220'}px`,
                }}
              />
            </motion.div>

            {/* Title text in front */}
            <motion.div
              className="relative z-20 text-center"
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
              <motion.div
                className="mt-3 inline-block px-5 py-1.5 rounded-full"
                style={{ border: "1px solid rgba(230, 57, 70, 0.3)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                <span className="text-lg sm:text-xl font-bold tracking-widest text-white">
                  {settings.hero_date || "2026.5.5"}
                </span>
              </motion.div>
              <motion.p
                className="mt-2 text-xs tracking-[0.2em] uppercase"
                style={{ color: "var(--text-secondary)" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
              >
                {settings.hero_subtitle || "Dance Showcase & Entertainment"}
              </motion.p>
            </motion.div>
          </div>

          {/* ── Bottom: Icon Grid (visible without scrolling) ── */}
          <motion.div
            className="relative z-10 w-full mt-4 px-1 sm:px-0"
            style={{ maxWidth: "min(340px, calc(100vw - 32px))" }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              {MENU_ITEMS.map((item, i) => (
                <motion.button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className="group relative flex flex-col items-center justify-center rounded-2xl p-3 sm:p-4 transition-all duration-300"
                  style={{
                    background: `linear-gradient(135deg, rgba(${item.color}, 0.08) 0%, rgba(22, 22, 22, 0.8) 100%)`,
                    border: `1px solid rgba(${item.color}, 0.2)`,
                    backdropFilter: "blur(12px)",
                  }}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    duration: 0.4,
                    delay: 0.4 + i * 0.06,
                    type: "spring",
                    stiffness: 200,
                  }}
                  whileTap={{ scale: 0.92 }}
                  whileHover={{
                    borderColor: `rgba(${item.color}, 0.5)`,
                    background: `linear-gradient(135deg, rgba(${item.color}, 0.18) 0%, rgba(22, 22, 22, 0.8) 100%)`,
                  }}
                >
                  <span className="relative z-10 text-2xl sm:text-3xl mb-1 drop-shadow-lg">
                    {item.emoji}
                  </span>
                  <span className="relative z-10 text-[10px] sm:text-xs font-bold leading-tight text-center"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {item.label}
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>

          {/* Scroll hint */}
          <motion.div
            className="relative z-10 mt-3 flex flex-col items-center gap-0.5"
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span className="text-[9px] tracking-[0.15em] text-[var(--text-muted)] uppercase">
              下にスクロールで詳細
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--text-muted)]"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </motion.div>
        </section>

        {/* ── Sections (unchanged) ── */}
        <div className="section-divider" />
        <ScheduleSection />
        <div className="section-divider" />
        <MerchSection />
        <div className="section-divider" />
        <VideoSection />
        <div className="section-divider" />
        <MusicSection />
        <div className="section-divider" />
        <VoteSection />
        <div className="section-divider" />
        <SNSSection />
        <Footer />
      </main>
    </>
  );
}
