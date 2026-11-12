import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

// /bw6 配下（BW6 発表会の家庭向けの画面）。検索に出さない。
export const metadata: Metadata = {
  title: 'BOOM 発表会 BW6',
  robots: { index: false, follow: false },
};

// ルートの themeColor は BW5 のオレンジ。iPhone の上下のバーをオレンジにしないため、生成り色に決め直す。
export const viewport: Viewport = {
  themeColor: '#faf6f1',
};

export default function Bw6Layout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* アプリ全体の body は BW5 オレンジの下地・白文字。/bw6 配下だけ生成り色（sand-50）の下地に紺（navy-700）の文字にする。
          印刷の時は背景を白にする。 */}
      <style>{'html, body { background: #faf6f1 !important; color: #101040 !important; } @media print { html, body { background: #fff !important; } }'}</style>
      <div className="max-w-xl mx-auto px-4 py-6">{children}</div>
    </>
  );
}
