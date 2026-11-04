// /mocchin 共通の見た目(告知画像と同じ黒×ネオン)。
// ⚠️ body の既定文字色が白。入力欄は文字色と背景色を必ずセットで明示する(規約11)。
import type { ReactNode } from 'react';

export const inputCls =
  'w-full rounded-lg border-2 border-[#19F2D6]/60 bg-white px-3 py-3 text-base font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-[#19F2D6]/40';

export const btnCls =
  'block w-full rounded-xl bg-[#19F2D6] py-4 text-center text-lg font-black text-black shadow-[0_0_24px_rgba(25,242,214,0.45)] disabled:opacity-50';

/** エラーがある入力欄はピンク枠にする */
export const errCls = (err?: string) => (err ? ' !border-[#FF4DB8] ring-2 ring-[#FF4DB8]/40' : '');

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-dvh overflow-x-clip text-white"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(25,242,214,0.22), rgba(0,0,0,0) 60%), #000' }}
    >
      <header className="mx-auto max-w-xl px-4 pt-6">
        <p className="text-xs font-black tracking-[0.2em] text-[#FF4DB8]">BOOM WOP VOL.6</p>
        <p className="mt-1 inline-block bg-[#19F2D6] px-2 py-0.5 text-sm font-black text-black">発表会スペシャルナンバー</p>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-16 pt-4">{children}</main>
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border-2 border-[#19F2D6]/70 bg-black/60 p-4 shadow-[0_0_18px_rgba(25,242,214,0.2)]">
      {title && <h2 className="mb-2 text-base font-black text-[#19F2D6]">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="mb-1 block text-sm font-black text-white">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-black text-[#FF4DB8]">⚠ {error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs font-bold text-white/70">{hint}</span>
      )}
    </label>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' }) {
  return (
    <div
      className={`mt-4 rounded-lg border-2 p-3 text-sm font-bold text-white ${
        tone === 'error' ? 'border-[#FF4DB8] bg-[#FF4DB8]/15' : 'border-[#19F2D6] bg-[#19F2D6]/10'
      }`}
    >
      {children}
    </div>
  );
}

/** プレビュー表示中の帯(スタッフの事前確認用であることをはっきり出す) */
export function PreviewBanner() {
  return (
    <p className="mb-2 rounded-lg border-2 border-dashed border-[#FF4DB8] p-2 text-center text-xs font-black text-[#FF4DB8]">
      プレビュー表示中(スタッフ確認用)：ここから送った申込は「テスト」の印つきで記録されます
    </p>
  );
}
