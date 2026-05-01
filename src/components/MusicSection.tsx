"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Music, ExternalLink } from "lucide-react";
import Image from "next/image";

// ── Hardcoded release (BW5 is a single-release event) ──
const RELEASE = {
  title: "Make It Boom",
  artist: "BOOM SENDAI",
  label: "BOOM Records",
  genre: "HIPHOP / R&B",
  writer: "BOOM SENDAI",
  releaseAt: "2026-05-04T00:00:00+09:00",
  jacketUrl: "/music/make_it_boom_jacket.jpg",
  smartLinkUrl: "https://linkco.re/E4SqSMGE",
  platforms: ["Spotify", "Apple Music", "LINE MUSIC", "Amazon Music", "YouTube Music", "iTunes Store"],
};

function Countdown({ releaseAt }: { releaseAt: string }) {
  const [remaining, setRemaining] = useState<{ d: number; h: number; m: number; s: number } | null>(null);

  useEffect(() => {
    const calc = () => {
      const diff = new Date(releaseAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining(null); return; }
      setRemaining({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [releaseAt]);

  if (!remaining) return null;

  const Cell = ({ value, label }: { value: number; label: string }) => (
    <div className="flex flex-col items-center min-w-[56px] px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.08)" }}>
      <span className="font-mono text-xl font-black text-white leading-none">{String(value).padStart(2, "0")}</span>
      <span className="text-[9px] font-bold text-white/60 tracking-widest mt-0.5">{label}</span>
    </div>
  );

  return (
    <div className="flex gap-2 justify-center">
      <Cell value={remaining.d} label="DAYS" />
      <Cell value={remaining.h} label="HOURS" />
      <Cell value={remaining.m} label="MIN" />
      <Cell value={remaining.s} label="SEC" />
    </div>
  );
}

export default function MusicSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [isReleased, setIsReleased] = useState(false);

  useEffect(() => {
    const check = () => setIsReleased(new Date(RELEASE.releaseAt).getTime() <= Date.now());
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="music" className="py-20 px-4 sm:px-6">
      <div className="max-w-lg mx-auto" ref={ref}>
        <motion.div
          className="text-center mb-10"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-2">
            MUSIC
          </h2>
          <p className="text-xs text-white/60">オリジナル楽曲 NEW RELEASE</p>
          <div className="section-divider max-w-[200px] mx-auto mt-3" />
        </motion.div>

        <motion.div
          className="rounded-3xl overflow-hidden"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)" }}
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          {/* Jacket */}
          <div className="relative w-full aspect-square bg-[#c7184c]">
            <Image
              src={RELEASE.jacketUrl}
              alt={RELEASE.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 90vw, 512px"
              priority
            />
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black tracking-widest"
                 style={{ background: "#fff", color: "#c7184c" }}>
              {isReleased ? "NEW RELEASE" : "PRE-ADD NOW"}
            </div>
          </div>

          {/* Info */}
          <div className="p-6">
            <p className="text-[11px] font-bold tracking-widest text-[#ff6b9a] mb-1">{RELEASE.artist}</p>
            <h3 className="text-2xl sm:text-3xl font-black text-white leading-tight">{RELEASE.title}</h3>
            <p className="text-xs text-white/50 mt-1">{RELEASE.label}</p>

            {!isReleased && (
              <div className="mt-5">
                <p className="text-[10px] font-bold tracking-widest text-white/70 text-center mb-2">
                  RELEASE COUNTDOWN
                </p>
                <Countdown releaseAt={RELEASE.releaseAt} />
              </div>
            )}

            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[11px]">
              <dt className="text-white/40 font-semibold">配信開始</dt>
              <dd className="text-white/90">2026年5月4日（月）</dd>
              <dt className="text-white/40 font-semibold">ジャンル</dt>
              <dd className="text-white/90">{RELEASE.genre}</dd>
              <dt className="text-white/40 font-semibold">作詞・作曲</dt>
              <dd className="text-white/90">{RELEASE.writer}</dd>
              <dt className="text-white/40 font-semibold">プラットフォーム</dt>
              <dd className="text-white/90 leading-relaxed">{RELEASE.platforms.join("、")}</dd>
            </dl>

            <p className="mt-5 text-[11px] text-white/60 leading-relaxed">
              {isReleased
                ? "各種サブスクリプションサービスで配信中。iTunes Store ではダウンロード販売も実施中。"
                : "Apple Music での Pre-Add、iTunes Store での予約購入が可能です。リリース日に通知を受け取れます。"}
            </p>

            <a
              href={RELEASE.smartLinkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 w-full py-3.5 rounded-full text-sm font-bold text-white flex items-center justify-center gap-2 transition-transform active:scale-95 shadow-lg"
              style={{ background: "linear-gradient(135deg, #c7184c 0%, #ff6b9a 100%)" }}
            >
              <Music size={16} />
              {isReleased ? "配信リンクを開く" : "Pre-Add / 予約購入へ"}
              <ExternalLink size={14} />
            </a>
            <p className="text-[10px] text-white/40 text-center mt-2">
              TuneCore Link（各配信プラットフォームへ）
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
