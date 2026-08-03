import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// /bf6 配下のタイトル/OGをサイト既定(BW5発表会)からイベント名に上書きする。
// LINE・Instagramのリンクプレビューはここの設定を表示する。
export const metadata: Metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 - BATTLE & SHOWCASE",
  description: '2026.9.26(土) SSM 9階ホール / BOOM DANCE SCHOOL主催ダンスバトル&ショーケース。エントリー受付中!',
  openGraph: {
    title: "BOOMER'S FIGHT!!! vol.6 - BATTLE & SHOWCASE",
    description: '2026.9.26(土) SSM 9階ホール / エントリー受付中!',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: "BOOMER'S FIGHT!!! vol.6",
    description: '2026.9.26(土) SSM 9階ホール / エントリー受付中!',
  },
};

export default function Bf6Layout({ children }: { children: ReactNode }) {
  return children;
}
