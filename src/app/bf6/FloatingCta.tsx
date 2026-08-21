'use client';

// スマホでヒーローを通り過ぎたあと、常に手の届く位置にエントリー導線を出す。
// ENTRYセクションが画面に入っている間は隠す(同じボタンが二重に見えるのを避けるため)。
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function Bf6FloatingCta() {
  const [scrolled, setScrolled] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 420);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // ENTRYセクションが見えている間は出さない
    const target = document.getElementById('bf6-entry-cta');
    let observer: IntersectionObserver | undefined;
    if (target && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => setCtaVisible(entries.some((e) => e.isIntersecting)),
        { rootMargin: '-80px 0px -80px 0px' }
      );
      observer.observe(target);
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, []);

  const show = scrolled && !ctaVisible;

  return (
    <Link
      href="/bf6/entry"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      className={`fixed bottom-5 right-4 z-50 flex h-14 items-center gap-2 rounded-full bg-gradient-to-b from-red-500 via-red-600 to-red-800 px-6 font-black text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_30px_-5px_rgba(220,38,38,0.65)] transition-all duration-300 ${
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
      }`}
    >
      エントリーする
    </Link>
  );
}
