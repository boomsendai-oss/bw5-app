"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

function Particle({ delay, x, size }: { delay: number; x: number; size: number }) {
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        width: size,
        height: size,
        left: `${x}%`,
        bottom: "-10%",
        background: `radial-gradient(circle, ${
          Math.random() > 0.5
            ? "rgba(230,57,70,0.6)"
            : "rgba(244,162,97,0.6)"
        }, transparent)`,
      }}
      animate={{
        y: [0, typeof window !== 'undefined' ? -window.innerHeight * 1.2 : -1000],
        opacity: [0, 1, 1, 0],
        scale: [0.5, 1, 0.8, 0.3],
      }}
      transition={{
        duration: 6 + Math.random() * 4,
        delay,
        repeat: Infinity,
        ease: "easeOut",
      }}
    />
  );
}

export default function HeroSection() {
  const [particles, setParticles] = useState<
    { id: number; delay: number; x: number; size: number }[]
  >([]);
  const [heroImage, setHeroImage] = useState("/images/upload_1776286511201.png");
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    const p = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      delay: Math.random() * 5,
      x: Math.random() * 100,
      size: 4 + Math.random() * 8,
    }));
    setParticles(p);

    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        if (data.hero_image) setHeroImage(data.hero_image);
      })
      .catch(() => {});
  }, []);

  return (
    <section
      id="hero"
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent-primary)]/10 via-transparent to-transparent" />

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

      {/* Particles */}
      <div className="absolute inset-0 pointer-events-none">
        {particles.map((p) => (
          <Particle key={p.id} delay={p.delay} x={p.x} size={p.size} />
        ))}
      </div>

      {/* Content */}
      <motion.div
        className="relative z-10 text-center px-6"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        {/* Hero Image */}
        <motion.div
          className="mx-auto mb-8 relative"
          style={{
            width: `${settings.hero_image_size || '200'}px`,
            height: `${settings.hero_image_size || '200'}px`,
          }}
          animate={{ y: [0, -12, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImage}
            alt="BOOM WOP vol.5"
            className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(230,57,70,0.4)]"
          />
        </motion.div>

        {/* Title */}
        <motion.h1
          className="text-5xl sm:text-7xl font-black tracking-tighter gradient-text mb-4"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          {settings.hero_title_line1 || "BOOM WOP"}
        </motion.h1>

        <motion.div
          className="text-6xl sm:text-8xl font-black tracking-tighter gradient-text mb-6"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {settings.hero_title_line2 || "vol.5"}
        </motion.div>

        {/* Date */}
        <motion.div
          className="inline-block px-6 py-2 rounded-full border border-[var(--accent-primary)]/30 mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <span className="text-2xl sm:text-3xl font-bold tracking-widest text-white">
            {settings.hero_date || "2026.5.5"}
          </span>
        </motion.div>

        {/* Subtitle */}
        <motion.p
          className="text-[var(--text-secondary)] text-sm sm:text-base tracking-[0.3em] uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          {settings.hero_subtitle || "Dance Showcase & Entertainment"}
        </motion.p>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <span className="text-[10px] tracking-[0.2em] text-[var(--text-muted)] uppercase">
          Scroll
        </span>
        <ChevronDown size={16} className="text-[var(--text-muted)]" />
      </motion.div>
    </section>
  );
}
