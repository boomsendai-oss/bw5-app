import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// /mocchin 配下のタイトル/OGをナンバー名に上書きする(LINEのリンクプレビューに出る)。
export const metadata: Metadata = {
  title: 'BW6 MOCCHIN SPナンバー 募集スタート',
  description: 'BOOM WOP vol.6(2027.4.11 若林区文化センター)スペシャルナンバーの申込ページ',
  openGraph: {
    title: 'BW6 MOCCHIN SPナンバー 募集スタート',
    description: '振り入れ全6日・参加費15,000円・申込締切12/13(日)',
    type: 'website',
  },
};

export default function MocchinLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* アプリ全体のbody下地はBW5オレンジ。/mocchin 配下だけ告知画像と同じ黒にする */}
      <style>{'html, body { background: #000 !important; }'}</style>
      {children}
    </>
  );
}
