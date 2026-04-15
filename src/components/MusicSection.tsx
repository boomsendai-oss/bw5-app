"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Lock, Music, ExternalLink } from "lucide-react";
import Image from "next/image";

interface MusicRelease {
  id: number;
  artist: string;
  title: string;
  jacket_url: string;
  apple_music_url: string;
  spotify_url: string;
  amazon_music_url: string;
  youtube_music_url: string;
  release_at: string;
}

function Countdown({ releaseAt }: { releaseAt: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const calc = () => {
      const diff = new Date(releaseAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("");
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(
        `${d > 0 ? `${d}d ` : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [releaseAt]);

  if (!remaining) return null;

  return (
    <div className="font-mono text-lg sm:text-xl font-bold text-[var(--accent-secondary)] tracking-wider">
      {remaining}
    </div>
  );
}

const STREAMING_SERVICES = [
  { key: "apple_music_url" as const, label: "Apple Music", color: "#fc3c44" },
  { key: "spotify_url" as const, label: "Spotify", color: "#1db954" },
  { key: "amazon_music_url" as const, label: "Amazon Music", color: "#25d1da" },
  { key: "youtube_music_url" as const, label: "YouTube Music", color: "#ff0000" },
];

export default function MusicSection() {
  const [releases, setReleases] = useState<MusicRelease[]>([]);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    fetch("/api/music")
      .then((r) => r.json())
      .then((data) => setReleases(data))
      .catch(() => {});
  }, []);

  const isReleased = (releaseAt: string) => {
    if (!releaseAt) return true;
    return new Date(releaseAt).getTime() <= Date.now();
  };

  return (
    <section id="music" className="py-20 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto" ref={ref}>
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight gradient-text mb-2">
            MUSIC
          </h2>
          <div className="section-divider max-w-[200px] mx-auto" />
        </motion.div>

        <div className="space-y-6">
          {releases.map((release, i) => {
            const released = isReleased(release.release_at);
            return (
              <motion.div
                key={release.id}
                className="card p-5 sm:p-6"
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.15 }}
              >
                <div className="flex gap-4 items-start">
                  {/* Album art / Vinyl */}
                  <div className="flex-shrink-0 w-24 h-24 sm:w-28 sm:h-28 relative">
                    {released ? (
                      <motion.div
                        className="w-full h-full rounded-full overflow-hidden border-2 border-[var(--accent-primary)]/30 shadow-lg"
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 8,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                      >
                        {release.jacket_url ? (
                          <Image
                            src={release.jacket_url}
                            alt={release.title}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-secondary)]/20 flex items-center justify-center">
                            <div className="w-6 h-6 rounded-full bg-[var(--bg-primary)] border-2 border-[var(--border-color)]" />
                          </div>
                        )}
                        {/* Vinyl hole */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-5 h-5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)]" />
                        </div>
                      </motion.div>
                    ) : (
                      <div className="w-full h-full rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center border border-[var(--border-color)]">
                        <Lock
                          size={28}
                          className="text-[var(--text-muted)]"
                        />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-0.5">
                      {release.artist}
                    </p>
                    <h3 className="font-bold text-white text-base sm:text-lg truncate">
                      {release.title}
                    </h3>

                    {released ? (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {STREAMING_SERVICES.map(
                          (service) =>
                            release[service.key] && (
                              <a
                                key={service.key}
                                href={release[service.key]}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105"
                                style={{
                                  backgroundColor: `${service.color}20`,
                                  color: service.color,
                                  border: `1px solid ${service.color}30`,
                                }}
                              >
                                <ExternalLink size={12} />
                                {service.label}
                              </a>
                            )
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-[var(--accent-primary)] font-semibold uppercase tracking-wider">
                          Coming Soon
                        </p>
                        <Countdown releaseAt={release.release_at} />
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {releases.length === 0 && (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <Music className="mx-auto mb-3 opacity-50" size={32} />
            <p className="text-sm">音楽情報準備中...</p>
          </div>
        )}
      </div>
    </section>
  );
}
