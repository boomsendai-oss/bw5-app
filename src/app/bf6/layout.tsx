import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// /bf6 配下のタイトル/OGをサイト既定(BW5発表会)からイベント名に上書きする。
// LINE・Instagramのリンクプレビューはここの設定を表示する。
export const metadata: Metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 - BATTLE & SHOWCASE",
  description: '2026.9.26(土) SSM 9階ホール / BOOM DANCE SCHOOL主催ダンスバトル&ショーケース。エントリー受付中!',
  icons: {
    // タブは16px。3文字だと潰れるため「B6」のクロムマークにした(2026-08-12)。
    // .ico に 16/32/48 を内蔵してサイズごとにシャープをかけてある。
    icon: [
      { url: '/bf6/favicon.ico', sizes: '16x16 32x32 48x48' },
      { url: '/bf6/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/bf6/apple-icon.png',
  },
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
  return (
    <>
      {/* アプリ全体のbody下地はBW5オレンジ(globals.cssの--bg-primary)。
          iPhoneの上下セーフエリア・オーバースクロールにその色が見えるため、
          /bf6 配下に限り下地を黒へ上書きする(TARO指摘 2026-08-05)。 */}
      <style>{'html, body { background: #0a0a0a !important; }'}</style>
      {children}
    </>
  );
}
