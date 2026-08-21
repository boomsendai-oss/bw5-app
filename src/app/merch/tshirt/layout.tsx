import type { Metadata } from 'next';
import type { ReactNode } from 'react';

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
  return children;
}
