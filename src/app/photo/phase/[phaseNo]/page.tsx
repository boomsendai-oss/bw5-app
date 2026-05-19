"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Clock,
  Camera,
  Hourglass,
  Video,
  ChevronRight,
} from "lucide-react";
import {
  PHOTO_PHASES,
  getPhaseReleaseDate,
  isPhaseReleased,
  findNextPhase,
  getGroupPhotoSrc,
  getPerformanceMeta,
  type PhotoPhaseItem,
} from "@/lib/photoPhases";
import { BaseShopSection, MadeToOrderBanner } from "@/components/ShopSection";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Countdown({ target }: { target: Date }) {
  const now = useNow(1000);
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return <span className="text-green-600 font-bold">公開中</span>;
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff / 3_600_000) % 24);
  const mins = Math.floor((diff / 60_000) % 60);
  const secs = Math.floor((diff / 1000) % 60);
  return (
    <span className="tabular-nums font-bold">
      {days > 0 && <>{days}日 </>}
      {String(hours).padStart(2, "0")}:{String(mins).padStart(2, "0")}:
      {String(secs).padStart(2, "0")}
    </span>
  );
}

export default function PhaseDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const preview = searchParams.get("preview") === "1";
  const phaseNo = Number(params.phaseNo);

  const phase = useMemo(
    () => PHOTO_PHASES.find((p) => p.phaseNo === phaseNo),
    [phaseNo]
  );

  const now = useNow(30000);

  if (!phase) {
    notFound();
  }

  const released = preview || isPhaseReleased(phase, now);
  const nextPhase = preview ? null : findNextPhase(now);

  return (
    <main className="min-h-screen pb-12" style={{ background: "#fff7ed" }}>
      {/* ─── 上部 sticky: 映像予約バナー (5/19締切後は非表示) ─── */}
      {(() => {
        const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
        const forceExpired = params?.get("expired") === "1";
        const expired = forceExpired || Date.now() >= new Date("2026-05-20T00:00:00+09:00").getTime();
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
          <Link href="/#merch" className="flex items-center gap-2.5 text-white">
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
          href="/photo"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#dc4c04] mb-3"
        >
          <ArrowLeft size={14} /> Phase一覧へ戻る
        </Link>
        <div className="flex items-center gap-2">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center font-black text-lg"
            style={{
              background:
                "linear-gradient(135deg, #f27a1a 0%, #dc4c04 100%)",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(220,76,4,0.3)",
            }}
          >
            {phase.phaseNo}
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 leading-tight">
              Phase {phase.phaseNo} 本番写真
            </h1>
            <p className="text-[10px] tracking-[0.18em] uppercase text-gray-500">
              RELEASE · {phase.releaseDate}
            </p>
          </div>
        </div>
      </header>

      {/* ─── 未公開バナー / 次のPhase カウントダウン ─── */}
      {!released && (
        <div className="px-4 mb-3">
          <div
            className="rounded-2xl px-4 py-4 text-center"
            style={{
              background: "#fff",
              border: "2px dashed #f27a1a",
            }}
          >
            <Hourglass
              size={26}
              className="mx-auto mb-1.5 text-[#dc4c04]"
            />
            <div className="text-sm font-black text-gray-900">
              このPhaseは {phase.releaseDate} 19:00 から公開予定です
            </div>
            <div className="text-xs text-gray-600 mt-2">
              公開まで:{" "}
              <Countdown target={getPhaseReleaseDate(phase)} />
            </div>
          </div>
        </div>
      )}

      {released && nextPhase && (
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
                次のPhase {nextPhase.phaseNo} 公開まで ({nextPhase.releaseDate} 19:00)
              </div>
              <div className="text-base mt-0.5 text-gray-900">
                <Countdown target={getPhaseReleaseDate(nextPhase)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 演目ボタン一覧 ─── */}
      <div className="px-4 space-y-2.5">
        {phase.items.map((item, i) => (
          <PerformanceCard
            key={item.mId}
            item={item}
            released={released}
            index={i}
            phaseNo={phase.phaseNo}
            preview={preview}
          />
        ))}
      </div>

      {/* ─── 下部: アパレル販売リンク ─── */}
      <div className="px-4 pt-8 space-y-3">
        <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray-500 px-1">
          APPAREL & MERCH
        </div>
        <MadeToOrderBanner />
        <BaseShopSection />
      </div>
    </main>
  );
}

function PerformanceCard({
  item,
  released,
  index,
  phaseNo,
  preview,
}: {
  item: PhotoPhaseItem;
  released: boolean;
  index: number;
  phaseNo: number;
  preview: boolean;
}) {
  const meta = getPerformanceMeta(item.mId);
  const photoSrc = getGroupPhotoSrc(item.mId);
  const hasUrl = item.driveUrl && item.driveUrl.trim().length > 0;
  const clickable = released && hasUrl;

  const cardBody = (
    <div
      className="rounded-2xl overflow-hidden flex items-stretch"
      style={{
        background: "#fff",
        border: "1px solid #f3e8da",
        boxShadow: clickable
          ? "0 4px 12px rgba(220,76,4,0.12)"
          : "0 1px 3px rgba(0,0,0,0.04)",
        opacity: released ? 1 : 0.7,
      }}
    >
      {/* 本番写真サムネ */}
      <div
        className="relative shrink-0"
        style={{
          width: 96,
          height: 96,
          background: "#fdf2e9",
        }}
      >
        {photoSrc ? (
          <Image
            src={photoSrc}
            alt={meta.title}
            fill
            sizes="96px"
            style={{ objectFit: "cover" }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Camera size={28} className="text-[#f27a1a]/50" />
          </div>
        )}
      </div>

      {/* テキスト */}
      <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col justify-center">
        <div className="text-sm font-black text-gray-900 leading-tight truncate">
          {meta.title}
        </div>
        {meta.subtitle && (
          <div className="text-[11px] text-gray-500 mt-0.5 truncate">
            {meta.subtitle}
          </div>
        )}

        {/* CTA */}
        <div className="mt-1.5">
          {!released ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400">
              <Hourglass size={11} /> 公開待ち
            </span>
          ) : hasUrl ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#dc4c04]">
              写真を見る →
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400">
              準備中
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      {clickable ? (
        <Link
          href={`/photo/phase/${phaseNo}/${item.mId}${preview ? "?preview=1" : ""}`}
          className="block active:scale-[0.98] transition-transform"
        >
          {cardBody}
        </Link>
      ) : (
        cardBody
      )}
    </motion.div>
  );
}
