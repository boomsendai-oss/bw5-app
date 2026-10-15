import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// /xmas 配下のタイトル/OGをイベント名に上書きする(LINEのリンクプレビューに出る)。
export const metadata: Metadata = {
  title: 'BOOM クリスマスパーティー 2026',
  description: '2026.12.19(土) 11:00〜16:00 SPACE ZERO / 参加申込・ショーケース出演エントリー',
  openGraph: {
    title: 'BOOM クリスマスパーティー 2026',
    description: '2026.12.19(土) SPACE ZERO / 参加申込・ショーケース出演エントリー',
    type: 'website',
    images: ['/xmas/hero-v2.jpg'],
  },
};

export default function XmasLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* アプリ全体のbody下地はBW5オレンジ・既定の文字色は白。iPhoneのセーフエリアに
          その色が見えないよう、/xmas 配下だけ下地を告知画像と同じ古紙色にする。 */}
      <style>{'html, body { background: #f3e6c4 !important; }'}</style>
      {children}
    </>
  );
}
