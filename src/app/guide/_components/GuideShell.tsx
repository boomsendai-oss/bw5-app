import type { ReactNode } from 'react';

export const LINE_URL = 'https://lin.ee/4EYB9zZ';
export const PORTAL_URL = 'https://boom.hacomono.jp/home';
/** hacomono純正の利用マニュアル（予約・入会のスライドはここが正） */
export const HACOMONO_MANUAL_URL =
  'https://coal-son-1e1.notion.site/77c7b25360fd4f0bafb9aa9da361b6d0';

/**
 * 会員向けガイドの各ページ共通の枠。
 * 設計: docs/superpowers/specs/2026-08-08-member-guide-redesign-design.md
 */
export function GuideShell({
  title,
  lead,
  children,
  helpNote,
}: {
  title: string;
  lead: string;
  children: ReactNode;
  /** 「困ったときは」に足す一文（そのページ固有の注意） */
  helpNote?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-sand-50 text-neutral-900">
      <header className="bg-navy-700 px-5 pb-7 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <a
            href="/guide"
            className="inline-flex items-center gap-1 text-[13px] text-brand-200 hover:text-white"
          >
            ← 使い方ガイド
          </a>
          <h1 className="mt-3 text-2xl font-bold leading-snug">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/70">{lead}</p>
        </div>
      </header>

      <div className="mx-auto max-w-md px-5 py-6">{children}</div>

      <div className="mx-auto max-w-md px-5 pb-10">
        <section className="rounded-xl bg-navy-700 p-5 text-center text-white">
          <p className="text-lg font-bold">うまくいかない時は</p>
          <p className="mt-1 text-sm leading-relaxed text-white/70">
            {helpNote ?? '無理に進めず、公式LINEでスタッフにご連絡ください。'}
          </p>
          <a
            href={LINE_URL}
            className="mt-4 block rounded-lg bg-[#06C755] py-3 font-semibold text-white"
          >
            💬 公式LINEで相談する
          </a>
        </section>
        <p className="pt-6 text-center text-xs text-neutral-400">BOOM Dance School</p>
      </div>
    </main>
  );
}

/** 押さえておくべき前提を目立たせる帯 */
export function GuideCallout({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn';
  children: ReactNode;
}) {
  const style =
    tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-brand-200 bg-brand-50 text-brand-900';
  return (
    <div className={`rounded-xl border p-4 text-[14px] leading-relaxed ${style}`}>{children}</div>
  );
}
