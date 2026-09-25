import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// /bf7 配下のタイトル/OGをサイト既定(BW5発表会)からイベント名に上書きする。
// LINE・Instagramのリンクプレビューはここの設定を表示する。
export const metadata: Metadata = {
  title: "BOOMER'S FIGHT!!! vol.7 | 2027.1.30(土) SSM 9階ホール",
  description:
    '2027.1.30(土) SSM 9階ホール / BOOM DANCE SCHOOL主催ダンスバトル。スペシャルゲスト Hiro(MIDDLE FILTER)。ウェイトリスト受付中!',
  openGraph: {
    title: "BOOMER'S FIGHT!!! vol.7",
    description: '2027.1.30(土) SSM 9階ホール / スペシャルゲスト Hiro(MIDDLE FILTER)',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: "BOOMER'S FIGHT!!! vol.7",
    description: '2027.1.30(土) SSM 9階ホール / スペシャルゲスト Hiro(MIDDLE FILTER)',
  },
};

export default function Bf7Layout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* ⚠️ アプリ全体のbody下地はBW5オレンジ(globals.cssの --bg-primary)。
          iPhoneの上下セーフエリア・オーバースクロールにその色が帯で見えるため、
          /bf7 配下に限り下地をvol.7の紺へ上書きする。
          /bf6 も同じことをしている(2026-08-05)。theme-colorだけ直しても帯は消えない。 */}
      <style>{'html, body { background: #0b1b36 !important; }'}</style>
      {children}
    </>
  );
}
