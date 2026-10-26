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
/** wide=文字数の多い見出し(WORKSHOP など)。横幅を広げて、ほかの見出しと文字の高さをそろえる */
export function Bf7SectionHead({ en, ja, img, wide = false }: { en: string; ja?: string; img?: string; wide?: boolean }) {
  return (
    <div className="mb-5 pt-2 text-center">
      {img ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 生成済みの静的画像 */
        <img src={img} alt={en} className={`mx-auto w-full ${wide ? 'max-w-[195px] md:max-w-[265px]' : 'max-w-[160px] md:max-w-[220px]'}`} />
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

// ===== ここから申込フォーム(/bf7/entry・/bf7/ticket ほか)用。vol.6の部品を青に振ったもの =====

/**
 * 入力欄。⚠️ 文字色と背景色を必ずセットで書く(bodyの既定文字色が白で、
 * 片方だけだと打った文字が見えなくなる事故が過去に何度も起きた)。
 */
export const inputCls =
  'w-full rounded-xl border-2 border-neutral-800 bg-neutral-900 px-3.5 py-3 text-base text-white placeholder:text-neutral-500 focus:border-sky-500 focus:outline-none';

/** エラー時は赤枠にする入力欄クラス(エラーは青にしない)。 */
export function inputClsWith(error?: string): string {
  return error ? `${inputCls} !border-red-500` : inputCls;
}

export const btnPrimaryCls =
  'bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-white ring-1 ring-blue-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(14,165,233,0.5)]';
export const btnDarkCls =
  'bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)]';

/** 申込ページの黒帯ヒーロー。 */
export function Bf7Hero({ title, subtitle }: { title: string; subtitle?: string }) {
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
        BOOMER&apos;S FIGHT!!! <span className="text-sky-400">vol.7</span>
      </p>
      <h1 className="mt-4 text-4xl font-black italic tracking-tight">
        {title}
        <span className="ml-1 text-sky-400">.</span>
      </h1>
      {subtitle && <p className="mt-1.5 text-sm font-bold text-neutral-300">{subtitle}</p>}
      <div className="mt-4 h-1 w-16 bg-sky-500" />
    </header>
  );
}

export function Bf7Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-neutral-900 to-neutral-950 p-4 ring-1 ring-neutral-700/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_20px_rgba(0,0,0,0.35)]">
      {label && <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-sky-400">{label}</p>}
      {children}
    </div>
  );
}

export function Bf7SectionTitle({ no, title, note }: { no?: string; title: string; note?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      {no && (
        <span className="flex h-7 w-7 shrink-0 translate-y-0.5 items-center justify-center bg-sky-600 text-sm font-black italic text-white">
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

export function Bf7Field({
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
        {label} {required && <span className="text-sky-400">*</span>}
      </span>
      {hint && <span className="block text-xs text-neutral-400">{hint}</span>}
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs font-bold text-red-400">⚠ {error}</span>}
    </label>
  );
}

export function Bf7NumberSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
      {Array.from({ length: 11 }, (_, n) => (
        <option key={n} value={n}>{n}枚</option>
      ))}
    </select>
  );
}

/**
 * 出場者の集合時刻。vol.7はタイムテーブル未確定(2026-10-20時点)。
 * ⚠️ 決まっていない時刻を書かない。確定したらここだけ直す(全フォーム共通)。
 */
export function Bf7CallTimeNotice() {
  return (
    <div className="mx-4 mt-4 rounded-2xl border border-sky-500/50 bg-sky-950/30 p-4">
      <p className="text-sm font-black text-sky-300">当日の集合時刻について</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-300">
        集合時刻・タイムテーブルは決まり次第、ご登録のメールアドレスとイベントページでお知らせします。
        受付で<span className="font-bold text-white">組み合わせ抽選(くじ引き)</span>を行う予定です。
      </p>
    </div>
  );
}

/** 受付前にスタッフが画面を確認しているときの帯。一般の人には出ない。 */
export function Bf7PreviewBanner() {
  return (
    <div className="bg-amber-400 px-4 py-2.5 text-center text-xs font-black text-neutral-950">
      確認用モード(スタッフのログイン中だけ表示・一般の方には「受付前」と出ます)
      <span className="block font-bold">送れるのは「当日会場でお支払い」だけ。テスト申込は定員・エントリーリストに数えません</span>
    </div>
  );
}
