// 特設ワークショップ(/ws)の共通パーツ。文字(講師名・日時・会場など)は必ず設定(DB)から受け取る。
import type { ReactNode } from 'react';

export const INK = '#16142b';
export const inputCls =
  'w-full rounded-xl border border-[#d9d3c7] bg-white px-3.5 py-3 text-base text-[#16142b] placeholder:text-slate-400 focus:border-[#ff6a2b] focus:outline-none focus:ring-2 focus:ring-[#ff6a2b]/25';
export const btnPrimaryCls = 'bg-gradient-to-r from-[#ffd23f] via-[#ffb02e] to-[#ff7a3d] text-[#16142b] shadow-[0_8px_24px_rgba(255,138,61,0.45)] ring-1 ring-white/40 transition hover:brightness-105 active:translate-y-px disabled:opacity-50';
export const btnSubCls = 'border border-[#16142b]/20 bg-white text-[#16142b] disabled:opacity-50';

export function WsShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f3ee] text-[#16142b]">
      <div className="mx-auto min-h-screen max-w-lg bg-[#f6f3ee] pb-28 md:my-8 md:min-h-0 md:overflow-hidden md:rounded-3xl md:pb-12 md:shadow-xl">
        {children}
      </div>
    </div>
  );
}

export function WsCard({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-5 shadow-[0_1px_0_rgba(22,20,43,0.06)] ring-1 ring-[#16142b]/5 ${className}`}>
      {title && (
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold tracking-wide">
          <span className="h-4 w-1 rounded-full bg-[#ff6a2b]" aria-hidden />
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function WsRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-[#efeae1] py-3 last:border-b-0">
      <p className="w-[4.5rem] shrink-0 pt-0.5 text-xs font-bold text-[#6b6880]">{k}</p>
      <div className="min-w-0 flex-1 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}

export function WsField({ label, required, optional, hint, children }: { label: string; required?: boolean; optional?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">
        {label}
        {required && <span className="rounded bg-[#16142b] px-1.5 py-0.5 text-[10px] font-bold text-white">必須</span>}
        {optional && <span className="rounded bg-[#efeae1] px-1.5 py-0.5 text-[10px] font-bold text-[#6b6880]">任意</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[#6b6880]">{hint}</span>}
    </label>
  );
}

export function WsError({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{children}</p>;
}

export function MultiLine({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {text.split(/\r?\n/).map((l, i) => (l.trim() ? <p key={i}>{l}</p> : <br key={i} />))}
    </div>
  );
}

/** 残り枠のバー。 */
export function SeatBar({ remaining, capacity }: { remaining: number; capacity: number }) {
  const ratio = capacity > 0 ? Math.min(1, Math.max(0, (capacity - remaining) / capacity)) : 1;
  const few = remaining > 0 && remaining <= Math.max(3, Math.ceil(capacity * 0.2));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-bold text-[#6b6880]">残り</p>
        <p className={`text-sm font-bold ${remaining === 0 ? 'text-red-700' : few ? 'text-[#c2410c]' : ''}`}>
          {remaining === 0 ? '満員' : <><span className="f-num text-3xl">{remaining}</span> / {capacity}枠</>}
        </p>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#efeae1]">
        <div className={`h-full rounded-full ${remaining === 0 ? 'bg-red-600' : few ? 'bg-[#ea580c]' : 'bg-[#ff6a2b]'}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      {few && <p className="mt-1 text-xs font-bold text-[#c2410c]">残りわずかです</p>}
    </div>
  );
}

export function WsPreviewBanner() {
  return (
    <div className="bg-amber-400 px-4 py-2 text-center text-xs font-bold text-[#16142b]">
      スタッフ確認用の表示です(受付していない間でも見えています)。送信は「テスト」として保存され、決済しません
    </div>
  );
}
