"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Camera,
  ChevronRight,
  Clock,
  CheckCircle2,
  Lock,
  ArrowLeft,
  Video,
} from "lucide-react";
import {
  PHOTO_PHASES,
  getPhaseReleaseDate,
  isPhaseReleased,
  findNextPhase,
} from "@/lib/photoPhases";
import { BaseShopSection, MadeToOrderBanner } from "@/components/ShopSection";

// ─────────────────────────────────────────────────────────────
// /photo — 本番写真公開トップ (Phase 一覧)
// ─────────────────────────────────────────────────────────────

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatRelease(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)} 19:00`;
}

function Countdown({ target }: { target: Date }) {
  const now = useNow(1000);
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) {
    return <span className="text-green-600 font-bold">公開中</span>;
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  const secs = Math.floor((diff / 1000) % 60);
  return (
    <span className="tabular-nums font-bold">
      {days > 0 && <>{days}日 </>}
      {String(hours).padStart(2, "0")}:{String(mins).padStart(2, "0")}:
      {String(secs).padStart(2, "0")}
    </span>
  );
}

export default function PhotoTopPage() {
  return (
    <Suspense fallback={null}>
      <PhotoTopPageInner />
    </Suspense>
  );
}

function PhotoTopPageInner() {
  const now = useNow(30000);
  const searchParams = useSearchParams();
  const preview = searchParams.get("preview") === "1";

  const nextPhase = useMemo(
    () => (preview ? null : findNextPhase(now)),
    [now, preview]
  );

  return (
    <main className="min-h-screen" style={{ background: "#fff7ed" }}>
      {/* ─── 上部 sticky: 映像予約バナー (5/19締切後は非表示) ─── */}
      {(() => {
        const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
        const forceExpired = params?.get("expired") === "1";
        const expired = forceExpired || now.getTime() >= new Date("2026-05-20T00:00:00+09:00").getTime();
        return !expired;
      })() && (
        <div
          className="sticky top-0 z-40 px-4 py-2.5"
          style={{
            background:
              "linear-gradient(135deg, #dc2626 0%, #ef4444 60%, #f97316 100%)",
            boxShadow: "0 4px 16px rgba(220,38,38,0.3)",
          }}
        >
          <Link
            href="/#merch"
            className="flex items-center gap-2.5 text-white"
          >
            <Video size={20} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] tracking-[0.18em] font-bold uppercase text-white/85">
                VIDEO · DEADLINE 5/19
              </div>
              <div className="text-sm font-black leading-tight truncate">
                映像データ予約受付中 (5/19 23:59まで)
              </div>
            </div>
            <ChevronRight size={18} className="shrink-0" />
          </Link>
        </div>
      )}

      {/* ─── Header ─── */}
      <header className="px-4 pt-4 pb-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#dc4c04] mb-3"
        >
          <ArrowLeft size={14} /> トップへ
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "#f27a1a" }}
          >
            <Camera size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 leading-tight">
              本番写真 公開ページ
            </h1>
            <p className="text-[10px] tracking-[0.18em] uppercase text-gray-500">
              BW5 GROUP PHOTOS
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed mt-2">
          全6Phaseに分けて順次公開します。各Phaseの公開日になると Drive リンクから写真がダウンロードできます。
        </p>
      </header>

      {/* ─── 次回公開カウントダウン ─── */}
      {nextPhase && (
        <div className="px-4 mb-3">
          <div
            className="rounded-2xl px-4 py-3 flex items-center gap-3"
            style={{
              background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
              border: "1px solid #fed7aa",
            }}
          >
            <Clock size={18} className="text-[#dc4c04] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold tracking-wider uppercase text-[#dc4c04]">
                Next · Phase {nextPhase.phaseNo} ({formatRelease(nextPhase.releaseDate)} 公開)
              </div>
              <div className="text-base mt-0.5 text-gray-900">
                <Countdown target={getPhaseReleaseDate(nextPhase)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Phase 一覧 (ハイブリッド型) ─── */}
      <div className="px-4 pb-6 space-y-2.5">
        {PHOTO_PHASES.map((phase, idx) => {
          const released = preview || isPhaseReleased(phase, now);
          const isNext = nextPhase?.phaseNo === phase.phaseNo;
          const status: "released" | "next" | "scheduled" = released
            ? "released"
            : isNext
            ? "next"
            : "scheduled";

          const cardStyle =
            status === "released"
              ? {
                  background:
                    "linear-gradient(135deg, #f27a1a 0%, #dc4c04 100%)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.3)",
                  boxShadow: "0 6px 18px rgba(220,76,4,0.28)",
                }
              : status === "next"
              ? {
                  background: "#fff",
                  color: "#1f2937",
                  border: "2px dashed #f27a1a",
                }
              : {
                  background: "#fff",
                  color: "#9ca3af",
                  border: "1px solid #e5e7eb",
                };

          return (
            <motion.div
              key={phase.phaseNo}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.05 }}
            >
              {status === "released" ? (
                <Link
                  href={`/photo/phase/${phase.phaseNo}${preview ? "?preview=1" : ""}`}
                  className="block rounded-2xl px-4 py-3.5 transition-transform active:scale-[0.98]"
                  style={cardStyle}
                >
                  <PhaseCardContent phase={phase} status={status} />
                </Link>
              ) : (
                <div
                  className="rounded-2xl px-4 py-3.5"
                  style={cardStyle}
                >
                  <PhaseCardContent phase={phase} status={status} />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* ─── 下部: アパレル販売リンク ─── */}
      <div className="px-4 pb-12 space-y-3">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray-500 px-1">
          APPAREL & MERCH
        </div>
        <MadeToOrderBanner />
        <BaseShopSection />
      </div>
    </main>
  );
}

function PhaseCardContent({
  phase,
  status,
}: {
  phase: (typeof PHOTO_PHASES)[number];
  status: "released" | "next" | "scheduled";
}) {
  const label =
    status === "released" ? "公開済" : status === "next" ? "次回公開" : "予定";
  const Icon =
    status === "released" ? CheckCircle2 : status === "next" ? Clock : Lock;

  return (
    <div className="flex items-center gap-3">
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-black text-lg"
        style={{
          background:
            status === "released"
              ? "rgba(255,255,255,0.22)"
              : status === "next"
              ? "#fff7ed"
              : "#f3f4f6",
          color:
            status === "released"
              ? "#fff"
              : status === "next"
              ? "#dc4c04"
              : "#9ca3af",
        }}
      >
        {phase.phaseNo}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon size={12} />
          <span className="text-[10px] font-bold tracking-wider uppercase">
            {label} · {formatRelease(phase.releaseDate)}
          </span>
        </div>
        <div
          className={`text-sm font-bold mt-0.5 ${
            status === "released" ? "" : "text-gray-900"
          }`}
        >
          Phase {phase.phaseNo} ({phase.items.length}演目)
        </div>
        <div
          className={`text-[11px] mt-0.5 ${
            status === "released"
              ? "text-white/85"
              : status === "next"
              ? "text-gray-500"
              : "text-gray-400"
          }`}
        >
          {status === "released" ? "タップで演目一覧を見る" : ""}
        </div>
      </div>

      {status === "released" && (
        <ChevronRight size={20} className="shrink-0 text-white/80" />
      )}
    </div>
  );
}
