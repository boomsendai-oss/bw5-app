import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// LINE等のリンクプレビューを、サイト既定(BW5発表会「BOOM WOP vol.5」)ではなく
// このフォームの内容で上書きする。
// 既定のままだと、公式LINEに貼ったときに「BOOM WOP vol.5 / 発表会 2026.05.05」と出て
// 何のリンクか伝わらない(2026-08-17 TARO指摘。出演者募集フォームと同じ対処)。
export const metadata: Metadata = {
  title: 'Instagramアカウントの登録 | BOOM Dance School',
  description: 'SNSでの発信時にメンションさせていただくため、Instagramのアカウント名を登録するフォームです。',
  openGraph: {
    title: 'Instagramアカウントの登録',
    description: 'BOOMのSNS発信でメンションさせていただくためのアカウント登録フォームです（任意）',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Instagramアカウントの登録',
    description: 'BOOMのSNS発信でメンションさせていただくためのアカウント登録フォームです（任意）',
  },
};

export default function IgLayout({ children }: { children: ReactNode }) {
  return children;
}
