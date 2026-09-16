// クルー画面の共通ヘッダー。メニューへ戻るだけの単純なもの。
// StaffPageHeader は /staff のナビ前提なのでここでは使わない。
'use client';

import Link, { useLinkStatus } from 'next/link';

/**
 * 押したことが見た目で分かるようにする。
 * ⚠️ 戻り先はDBを見に行くので表示まで一瞬かかる。押しても何も変わらないと
 *    「効いていない」と思って二度押しになる(TARO実機 2026-09-16)。
 */
function BackLabel() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        aria-hidden
        className={`h-3 w-3 shrink-0 rounded-full border-2 border-navy-300 border-t-navy-800 transition-opacity ${
          pending ? 'animate-spin opacity-100' : 'opacity-0'
        }`}
      />
      <span>{pending ? '戻っています…' : '← 戻る'}</span>
      {!pending && <span className="text-xs font-bold text-neutral-500">(メニュー)</span>}
    </>
  );
}

export default function CrewHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="border-b border-sand-200 bg-white px-4 py-3">
      <Link
        href="/bf6/crew"
        className="inline-flex items-center gap-1 rounded-full border border-sand-300 bg-sand-50 px-3 py-1.5 text-sm font-black text-navy-800 active:scale-95 active:bg-sand-200"
      >
        <BackLabel />
      </Link>
      <h1 className="mt-1 text-xl font-black text-navy-900">{title}</h1>
      {description && <p className="text-xs text-neutral-500">{description}</p>}
    </header>
  );
}
