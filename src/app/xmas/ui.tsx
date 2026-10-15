// /xmas 共通の見た目(告知画像A案のレトロコミック調: 古紙・赤・緑・墨の太線)。
// ⚠️ body の既定文字色が白なので、文字色はこのシェルで必ず明示する(規約11)。
import Link from 'next/link';
import type { ReactNode } from 'react';

export const INK = '#1a1410';

/** 入力欄は文字色と背景色をセットで明示する(白文字×白背景の事故防止)。 */
export const inputCls =
  'w-full rounded-lg border-[3px] border-[#1a1410] bg-white px-3 py-3 text-base font-bold text-[#1a1410] placeholder:font-normal placeholder:text-neutral-400 focus:outline-none focus:ring-4 focus:ring-[#f4cf3e]';

export const primaryBtnCls =
  'block w-full rounded-xl border-[3px] border-[#1a1410] bg-[#d4302a] py-4 text-center text-lg font-black text-white shadow-[5px_5px_0_#1a1410] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[3px_3px_0_#1a1410] disabled:opacity-50';

export const greenBtnCls =
  'block w-full rounded-xl border-[3px] border-[#1a1410] bg-[#2f8a3e] py-4 text-center text-lg font-black text-white shadow-[5px_5px_0_#1a1410] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[3px_3px_0_#1a1410] disabled:opacity-50';

export function XmasShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-dvh overflow-x-clip text-[#1a1410]"
      style={{
        backgroundColor: '#f3e6c4',
        backgroundImage: 'radial-gradient(rgba(120,80,30,0.13) 1.2px, transparent 1.4px)',
        backgroundSize: '9px 9px',
      }}
    >
      <header className="border-b-[3px] border-[#1a1410] bg-[#d4302a]">
        <Link href="/xmas" className="mx-auto block max-w-xl px-4 py-2 text-center text-sm font-black tracking-wide text-white">
          BOOM CHRISTMAS PARTY 2026
        </Link>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16 pt-5">{children}</main>
    </div>
  );
}

export function Panel({ title, children, tone = 'red' }: { title?: string; children: ReactNode; tone?: 'red' | 'green' }) {
  return (
    <section className="relative mt-6 rounded-xl border-[3px] border-[#1a1410] bg-[#fffaf0] p-4 shadow-[6px_6px_0_#1a1410]">
      {title && (
        <h2
          className={`-mt-8 mb-3 inline-block -rotate-1 border-[3px] border-[#1a1410] px-3 py-1 text-base font-black text-white shadow-[3px_3px_0_#1a1410] ${
            tone === 'red' ? 'bg-[#d4302a]' : 'bg-[#2f8a3e]'
          }`}
        >
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-dashed border-[#1a1410]/30 py-2 last:border-0">
      <dt className="w-24 shrink-0 text-sm font-black text-[#2f8a3e]">{k}</dt>
      <dd className="text-sm font-bold">{v}</dd>
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <p
      className={`mt-4 rounded-lg border-[3px] border-[#1a1410] p-3 text-sm font-bold ${
        tone === 'error' ? 'bg-[#ffe1dc] text-[#9b1c16]' : 'bg-[#f4cf3e] text-[#1a1410]'
      }`}
    >
      {children}
    </p>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="mb-1 block text-sm font-black">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-black text-[#c0241f]">⚠ {error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs font-bold text-neutral-600">{hint}</span>
      )}
    </label>
  );
}

/** エラーがある入力欄は赤枠にする。 */
export const errCls = (err?: string) => (err ? ' !border-[#d4302a] ring-2 ring-[#d4302a]/30' : '');
