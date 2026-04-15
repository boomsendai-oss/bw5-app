"use client";

import { useState, useEffect, useCallback } from "react";
import Navigation from "@/components/Navigation";
import HeroSection from "@/components/HeroSection";
import ScheduleSection from "@/components/ScheduleSection";
import MerchSection from "@/components/MerchSection";
import MusicSection from "@/components/MusicSection";
import VideoSection from "@/components/VideoSection";
import VoteSection from "@/components/VoteSection";
import SNSSection from "@/components/SNSSection";
import Footer from "@/components/Footer";

const SECTION_IDS = [
  "sns",
  "vote",
  "video",
  "music",
  "merch",
  "schedule",
  "hero",
];

export default function Home() {
  const [activeSection, setActiveSection] = useState("schedule");

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
      <Navigation
        activeSection={activeSection}
        onNavigate={handleNavigate}
      />
      <main className="bg-noise">
        <div id="hero">
          <HeroSection />
        </div>
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
