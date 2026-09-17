// クルー画面のリンクに付ける「押したよ」の印。
//
// ⚠️ 行き先はどれもDBを見に行くので、押してから表示まで一瞬かかる。
//    その間なにも変わらないと「効いていない」と思って二度押しになる
//    (TARO実機 2026-09-16「1回ピッと押しても反応しなくて、もう1回押せば戻る」)。
// ⚠️ loading.tsx では直さないこと。この route group に置くと本番で仮表示のまま
//    固まる(HTMLには中身が入っているのに差し替わらない・2026-09-16に本番で発生)。
'use client';

import { useLinkStatus } from 'next/link';

/**
 * Link の中に置く。場所は常に確保しておき、出し入れで位置がずれないようにする。
 */
export function Spinner() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand-200 border-t-brand-700 transition-opacity ${
        pending ? 'animate-spin opacity-100' : 'opacity-0'
      }`}
    />
  );
}
