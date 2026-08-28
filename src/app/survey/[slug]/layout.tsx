import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getSurveyBySlug } from '@/lib/surveyDb';

// リンクプレビューをサイト既定(BW5発表会)ではなくアンケート名で上書きする(/entry・/igと同じ対処)。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const survey = /^[0-9a-f]{16}$/.test(slug) ? await getSurveyBySlug(slug) : null;
  const title = survey && survey.status !== 'draft' ? survey.title : 'アンケート';
  const description = 'BOOM Dance Schoolのアンケートフォームです。';
  return {
    title: `${title} | BOOM Dance School`,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default function SurveyLayout({ children }: { children: ReactNode }) {
  return children;
}
