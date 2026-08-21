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
        className={`relative mx-auto min-h-screen bg-neutral-950 pb-12 md:min-h-0 md:overflow-hidden md:rounded-3xl md:shadow-2xl md:shadow-red-950/50 md:ring-1 md:ring-white/10 md:my-10 ${
          full ? 'max-w-lg md:max-w-5xl' : wide ? 'max-w-lg md:max-w-2xl' : 'max-w-lg md:max-w-xl'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export const inputCls =
  'w-full rounded-xl border-2 border-neutral-800 bg-neutral-900 px-3.5 py-3 text-base text-white placeholder-neutral-600 focus:border-red-500 focus:outline-none';

/** 黒帯ヒーロー。バトルイベントのブランド面はここに集約し、本文はライトで読みやすく。 */
export function Bf6Hero({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="bg-neutral-950 px-4 pb-6 pt-8 text-white">
      {/* 主催スクールへの導線。別タブなので申込フォーム記入中でも入力は消えない */}
      <a
        href="https://boom-sendai.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-[11px] font-bold tracking-[0.25em] text-neutral-400 hover:text-white"
      >
        BOOM DANCE SCHOOL PRESENTS
      </a>
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

// 立体感のあるボタン面(質感アップ・TARO 2026-08-05)。文言はテキストのまま
export const btnPrimaryCls =
  'bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)]';
export const btnDarkCls =
  'bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)]';
/** 色付きボックス(部門チップ等)に足す立体仕上げ。 */
export const glossCls = 'ring-1 ring-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_rgba(0,0,0,0.4)]';

export function Bf6Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-neutral-900 to-neutral-950 p-4 ring-1 ring-neutral-700/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_20px_rgba(0,0,0,0.35)]">
      {label && (
        <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-red-400">{label}</p>
      )}
      {children}
    </div>
  );
}

export function Bf6SectionTitle({ no, title, note }: { no?: string; title: string; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      {no && (
        <span className="flex h-7 w-7 shrink-0 translate-y-0.5 items-center justify-center bg-red-600 text-sm font-black italic text-white">
          {no}
        </span>
      )}
      <div>
        <h2 className="text-lg font-black text-white">{title}</h2>
        {note && <p className="text-xs text-neutral-400">{note}</p>}
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
      <span className="text-sm font-bold text-neutral-200">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {hint && <span className="block text-xs text-neutral-400">{hint}</span>}
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs font-bold text-red-400">⚠ {error}</span>}
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
        /* 透過PNG(黒抜き済み)をそのまま置く。ヒーローのタイトルより控えめなサイズに */
        /* eslint-disable-next-line @next/next/no-img-element -- 生成済み静的画像 */
        <img src={img} alt={en} className="mx-auto w-full max-w-[160px] md:max-w-[220px]" />
      ) : (
        <h2 className="text-3xl font-black italic tracking-tight text-white md:text-5xl">
          {en}
          <span className="text-red-400">.</span>
        </h2>
      )}
      {ja && <p className="mt-2 text-xs font-bold text-neutral-400">{ja}</p>}
      {!img && <div className="mx-auto mt-3 h-1 w-12 bg-red-600" />}
    </div>
  );
}

/**
 * DETAIL内の小見出し(DATE / TIME / FEE ...)。赤バー+赤文字で区切りを明確に。
 * ja=日本語の補助ラベル(英語が読めない人向け・小さくグレーで添える)。
 */
export function Bf6DetailBlock({ en, ja, children }: { en: string; ja?: string; children: ReactNode }) {
  return (
    <div className="border-b border-neutral-800 py-4 last:border-b-0">
      <h3 className="flex items-baseline gap-2">
        <span className="h-4 w-1.5 self-center skew-x-[-12deg] bg-gradient-to-b from-red-500 to-red-700" />
        <span className="text-sm font-black italic tracking-widest text-red-500">{en}</span>
        {ja && <span className="text-[11px] font-bold text-neutral-500">{ja}</span>}
      </h3>
      <div className="mt-2.5 pl-3.5">{children}</div>
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

/**
 * 出場者の集合時刻バナー。バトルエントリー(有料)とSSM学生無料枠の
 * 両フォームで共用する。片方だけ直し忘れる事故を防ぐため必ずこれを使う。
 */
export function Bf6CallTimeNotice() {
  return (
    <div className="mx-4 mt-4 rounded-2xl border border-orange-500/60 bg-orange-950/30 p-4">
      <p className="text-sm font-black text-orange-400">バトルエントリー者は 13:30 集合です</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-300">
        当日は <span className="font-bold text-white">13:30</span> に SSM 9階ホール前へお越しください
        (<span className="font-bold text-white">14:00 締切</span>)。
        受付で<span className="font-bold text-white">組み合わせ抽選(くじ引き)</span>を行います。
        遅れると抽選に参加できず、運営サイドで決定を行う場合があります。
      </p>
      <p className="mt-1 text-xs text-neutral-400">※ 観覧の方の開場は 14:30 です</p>
    </div>
  );
}
