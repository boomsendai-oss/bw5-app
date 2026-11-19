// 月1回の校内プチバトル(/battle)の共通パーツ。イベント名は未定なので、名前は必ず設定(DB)から受け取る。
import type { ReactNode } from 'react';

export function BattleShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto min-h-screen max-w-lg bg-neutral-950 pb-12 md:my-8 md:min-h-0 md:rounded-3xl md:ring-1 md:ring-white/10">
        {children}
      </div>
    </div>
  );
}

export function BattleHero({ eventTitle, title, subtitle }: { eventTitle: string; title: string; subtitle?: string }) {
  return (
    <header className="px-4 pb-6 pt-8 text-white">
      <a
        href="https://boom-sendai.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-[11px] font-bold tracking-[0.25em] text-neutral-400 hover:text-white"
      >
        BOOM DANCE SCHOOL PRESENTS
      </a>
      <p className="mt-1 text-lg font-black leading-tight text-teal-300">{eventTitle}</p>
      <h1 className="mt-4 text-3xl font-black tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm font-bold text-neutral-300">{subtitle}</p>}
      <div className="mt-4 h-1 w-16 bg-teal-400" />
    </header>
  );
}

export function BattleCard({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-neutral-900 p-4 ring-1 ring-neutral-700/60">
      {label && <p className="mb-2 text-[11px] font-black tracking-widest text-teal-300">{label}</p>}
      {children}
    </div>
  );
}

/**
 * 入力欄。⚠️ 文字色と背景色を必ずセットで書く(bodyの既定文字色が白で、
 * 片方だけだと打った文字が見えなくなる事故が過去に何度も起きた・CLAUDE.md 規約11)。
 */
export const inputCls =
  'w-full rounded-xl border-2 border-neutral-700 bg-neutral-800 px-3.5 py-3 text-base text-white placeholder:text-neutral-500 focus:border-teal-400 focus:outline-none [color-scheme:dark]';

export const btnPrimaryCls = 'bg-teal-500 text-neutral-950 hover:bg-teal-400 disabled:opacity-50';
export const btnDarkCls = 'bg-neutral-800 text-white ring-1 ring-neutral-600';

export function BattleField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-neutral-200">
        {label} {required ? <span className="text-teal-300">*</span> : <span className="text-xs font-normal text-neutral-500">(任意)</span>}
      </span>
      {hint && <span className="block text-xs text-neutral-400">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/** 受付前にスタッフが画面を確認しているときの帯。一般の人には出ない。 */
export function BattlePreviewBanner() {
  return (
    <div className="bg-amber-400 px-4 py-2.5 text-center text-xs font-black text-neutral-950">
      確認用モード(スタッフのログイン中だけ表示・一般の方には「受付していません」と出ます)
      <span className="block font-bold">送った申込は「テスト」として保存され、決済はせず、定員・エントリー一覧にも数えません</span>
    </div>
  );
}

/** 改行入りの設定文をそのまま段落で出す。 */
export function MultiLine({ text, className = '' }: { text: string; className?: string }) {
  return <p className={`whitespace-pre-line ${className}`}>{text}</p>;
}
