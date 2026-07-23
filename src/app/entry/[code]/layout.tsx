import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { findEventByCode } from '@/lib/eventSignupDb';

// 申込フォームのタイトル/OGを、サイト既定(BW5発表会)ではなくイベント名で上書きする。
// LINE等のリンクプレビューは、ここで設定したタイトル/説明を表示する。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const ev = await findEventByCode(code);
  const name = ev?.name ?? 'イベント';
  const title = `${name} 出演者募集`;
  const description = '出演するパートを選んで申し込むフォームです。';
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default function EntryLayout({ children }: { children: ReactNode }) {
  return children;
}
