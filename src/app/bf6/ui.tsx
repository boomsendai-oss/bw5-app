// BF6公開ページ共通のUI部品。ライト基調+黒/赤(フライヤー準拠)のイベントデザイン。
import type { ReactNode } from 'react';

/**
 * 全公開ページ共通の外枠。スマホ=ライト面がそのまま全幅(従来通り)。
 * PC=黒いステージ+赤のライティングの上にページが浮かぶ(迫力対策・TARO 2026-08-05)。
 */
export function Bf6Shell({
  children,
  wide = false,
  full = false,
}: {
  children: ReactNode;
  wide?: boolean;
  full?: boolean;
}) {
  return (
    <div className="relative min-h-screen bg-neutral-950">
      {/* 装飾(PCの余白を舞台にする)。pointer-events-noneで操作に影響しない */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block">
        <div className="absolute -left-40 top-[-10%] h-[34rem] w-[34rem] rounded-full bg-red-600/25 blur-[140px]" />
        <div className="absolute -right-48 top-1/3 h-[40rem] w-[40rem] rounded-full bg-red-900/30 blur-[160px]" />
        <div className="absolute bottom-[-15%] left-1/4 h-[30rem] w-[30rem] rounded-full bg-neutral-700/20 blur-[140px]" />
        <p className="absolute left-6 top-1/2 -translate-y-1/2 -rotate-90 whitespace-nowrap text-[11rem] font-black italic leading-none tracking-tighter text-white/[0.04] select-none">
          BOOMER&apos;S FIGHT!!!
        </p>
        <p className="absolute right-6 top-1/2 -translate-y-1/2 rotate-90 whitespace-nowrap text-[11rem] font-black italic leading-none tracking-tighter text-white/[0.04] select-none">
          BATTLE &amp; SHOWCASE
        </p>
      </div>
      <div
        className={`relative mx-auto min-h-screen bg-neutral-100 pb-12 md:min-h-0 md:overflow-hidden md:rounded-3xl md:shadow-2xl md:shadow-red-950/50 md:ring-1 md:ring-white/10 md:my-10 ${
          full ? 'max-w-lg md:max-w-5xl' : wide ? 'max-w-lg md:max-w-2xl' : 'max-w-lg md:max-w-xl'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export const inputCls =
  'w-full rounded-xl border-2 border-neutral-200 bg-white px-3.5 py-3 text-base text-neutral-900 placeholder-neutral-300 focus:border-red-500 focus:outline-none';

/** 黒帯ヒーロー。バトルイベントのブランド面はここに集約し、本文はライトで読みやすく。 */
export function Bf6Hero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="bg-neutral-950 px-4 pb-6 pt-8 text-white">
      <p className="text-[11px] font-bold tracking-[0.25em] text-neutral-400">
        BOOM DANCE SCHOOL PRESENTS
      </p>
      <p className="mt-1 text-lg font-black italic leading-none">
        BOOMER&apos;S FIGHT!!! <span className="text-red-500">vol.6</span>
      </p>
      <h1 className="mt-4 text-4xl font-black italic tracking-tight">
        {title}
        <span className="ml-1 text-red-500">.</span>
      </h1>
      {subtitle && <p className="mt-1.5 text-sm font-bold text-neutral-300">{subtitle}</p>}
      <div className="mt-4 h-1 w-16 bg-red-600" />
    </header>
  );
}

export function Bf6Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      {label && (
        <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-red-600">{label}</p>
      )}
      {children}
    </div>
  );
}

export function Bf6SectionTitle({ no, title, note }: { no?: string; title: string; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      {no && (
        <span className="flex h-7 w-7 shrink-0 translate-y-0.5 items-center justify-center bg-neutral-900 text-sm font-black italic text-white">
          {no}
        </span>
      )}
      <div>
        <h2 className="text-lg font-black text-neutral-900">{title}</h2>
        {note && <p className="text-xs text-neutral-500">{note}</p>}
      </div>
    </div>
  );
}

export function Bf6Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-neutral-800">
        {label} {required && <span className="text-red-600">*</span>}
      </span>
      {hint && <span className="block text-xs text-neutral-400">{hint}</span>}
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs font-bold text-red-600">⚠ {error}</span>}
    </label>
  );
}

/** エラー時は赤枠にする入力欄クラス。 */
export function inputClsWith(error?: string): string {
  return error ? `${inputCls} !border-red-500` : inputCls;
}

/**
 * DANCEALIVE風の英字大見出し。img を渡すとフライヤーと同系のクロムメタル
 * レタリング画像(Gemini生成・黒地)をメタルプレート風に表示する(TARO 2026-08-05)。
 */
export function Bf6SectionHead({ en, ja, img }: { en: string; ja?: string; img?: string }) {
  return (
    <div className="mb-5 pt-2 text-center">
      {img ? (
        <div className="mx-auto max-w-[320px] overflow-hidden rounded-2xl bg-black shadow-lg shadow-neutral-900/30 ring-1 ring-neutral-800 md:max-w-[440px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- 生成済み静的画像 */}
          <img src={img} alt={en} className="w-full" />
        </div>
      ) : (
        <h2 className="text-3xl font-black italic tracking-tight text-neutral-900 md:text-5xl">
          {en}
          <span className="text-red-600">.</span>
        </h2>
      )}
      {ja && <p className="mt-2 text-xs font-bold text-neutral-500">{ja}</p>}
      {!img && <div className="mx-auto mt-3 h-1 w-12 bg-red-600" />}
    </div>
  );
}

/** DETAIL内の小見出し(DATE / TIME / FEE ...)。 */
export function Bf6DetailBlock({ en, children }: { en: string; children: ReactNode }) {
  return (
    <div className="border-b border-neutral-200 py-4 last:border-b-0">
      <h3 className="text-sm font-black italic tracking-widest text-neutral-400">{en}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function Bf6NumberSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
      {Array.from({ length: 11 }, (_, n) => (
        <option key={n} value={n}>{n}枚</option>
      ))}
    </select>
  );
}
