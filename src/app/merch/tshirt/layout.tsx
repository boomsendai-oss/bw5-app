import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

// ブラウザの上下バーの色。既定はBW5オレンジ(#f27a1a)で、黒基調のこのページだと
// iPhoneで上下にオレンジの帯が見切れる。ここと layout.tsx のブートストラップの両方で黒にする。
export const viewport: Viewport = {
  themeColor: '#0b0b0c',
};

// LINE等のリンクプレビュー用。サイト既定(BW5発表会)のタイトルを商品名で上書きする。
export const metadata: Metadata = {
  title: 'BOOM オフィシャルTシャツ（黒×黒モデル）| ご注文',
  description: '黒のボディに黒でロゴをのせた、BOOMのオフィシャルTシャツ。8/29(土)まで受付中。',
  openGraph: {
    title: 'BOOM オフィシャルTシャツ（黒×黒モデル）',
    description: '黒のボディに黒でロゴをのせた、BOOMのオフィシャルTシャツ。8/29(土)まで受付中。',
    type: 'website',
    images: ['/merch/tshirt_black_black.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BOOM オフィシャルTシャツ（黒×黒モデル）',
    description: '黒のボディに黒でロゴをのせた、BOOMのオフィシャルTシャツ。8/29(土)まで受付中。',
    images: ['/merch/tshirt_black_black.jpg'],
  },
};

export default function TshirtLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/*
        globals.css の body は BW5オレンジ(--bg-primary: #f27a1a)。
        iPhoneでスクロールを端まで弾ませると、その地色が上下にオレンジの帯として見える。
        このルートにいる間だけ黒で塗り潰す(離れれば自動で元に戻る)。
      */}
      <style>{'body{background:#0b0b0c}'}</style>
      {children}
    </>
  );
}
