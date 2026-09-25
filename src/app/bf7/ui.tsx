// vol.7 告知ページの共通パーツ。作りはvol.6(`/bf6/ui.tsx`)と同じで、赤→青に振ってある
// (TARO 2026-09-25「基本的には全く同じような形で、色はブルーに」)。
import type { ReactNode } from 'react';

/** 全体の外枠。PCでは黒いステージの上にページが浮かぶ(vol.6と同じ作り・光だけ青) */
export function Bf7Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-neutral-950">
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block">
        <div className="absolute -left-40 top-[-10%] h-[34rem] w-[34rem] rounded-full bg-sky-600/25 blur-[140px]" />
        <div className="absolute -right-48 top-1/3 h-[40rem] w-[40rem] rounded-full bg-blue-900/35 blur-[160px]" />
        <div className="absolute bottom-[-15%] left-1/4 h-[30rem] w-[30rem] rounded-full bg-neutral-700/20 blur-[140px]" />
        <p className="absolute left-6 top-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap text-[11rem] font-black italic leading-none tracking-tighter text-white/[0.04] select-none">
          BOOMER&apos;S FIGHT!!!
        </p>
        <p className="absolute right-6 top-1/2 -translate-y-1/2 rotate-90 whitespace-nowrap text-[11rem] font-black italic leading-none tracking-tighter text-white/[0.04] select-none">
          VOL.7
        </p>
      </div>
      <div className="relative mx-auto min-h-screen max-w-lg bg-neutral-950 pb-12 md:my-10 md:min-h-0 md:max-w-xl md:overflow-hidden md:rounded-3xl md:shadow-2xl md:shadow-blue-950/50 md:ring-1 md:ring-white/10">
        {children}
      </div>
    </div>
  );
}

/** セクションの見出し。青クロームの画像(vol.6の見出しを青に振り直したもの)を置く */
export function Bf7SectionHead({ en, ja, img }: { en: string; ja?: string; img?: string }) {
  return (
    <div className="mb-5 pt-2 text-center">
      {img ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 生成済みの静的画像 */
        <img src={img} alt={en} className="mx-auto w-full max-w-[160px] md:max-w-[220px]" />
      ) : (
        <h2 className="text-3xl font-black italic tracking-tight text-white md:text-5xl">
          {en}
          <span className="text-sky-400">.</span>
        </h2>
      )}
      {ja && <p className="mt-2 text-xs font-bold text-neutral-400">{ja}</p>}
      {!img && <div className="mx-auto mt-3 h-1 w-12 bg-sky-500" />}
    </div>
  );
}

/** DETAIL内の小見出し(DATE / TIME / FEE …)。 */
export function Bf7DetailBlock({ en, ja, children }: { en: string; ja?: string; children: ReactNode }) {
  return (
    <div className="border-b border-neutral-800 py-4 last:border-b-0">
      <h3 className="flex items-baseline gap-2">
        <span className="h-4 w-1.5 self-center skew-x-[-12deg] bg-gradient-to-b from-sky-400 to-blue-600" />
        <span className="text-sm font-black italic tracking-widest text-sky-400">{en}</span>
        {ja && <span className="text-[11px] font-bold text-neutral-500">{ja}</span>}
      </h3>
      <div className="mt-2.5 pl-3.5">{children}</div>
    </div>
  );
}

/**
 * まだ決まっていない項目。
 * ⚠️ 未定のものを決まったように書かない。ここに入れて「決まり次第お知らせ」とだけ言う。
 */
export function ComingSoon({ note }: { note?: string }) {
  return (
    <div>
      <span className="inline-block rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-black tracking-[0.18em] text-sky-300 ring-1 ring-sky-500/30">
        COMING SOON
      </span>
      <p className="mt-2 text-xs leading-relaxed text-neutral-400">{note ?? '決まり次第、このページでお知らせします。'}</p>
    </div>
  );
}
