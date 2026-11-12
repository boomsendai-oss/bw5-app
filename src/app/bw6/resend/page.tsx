// ⚠️ 公開ページ(認証なし)。理由: 公式LINE の『発表会』ボタン・申込フォームの画面0から開く「マイページのURLを送ります」。
// 出すのはメールの欄とボタンだけ。答えはいつも同じ文で、申込があるかは出さない（resendUrlAction）。個人の情報を URL に載せない。
import Link from 'next/link';
import { getRecitalPublicContext } from '../context';
import { ResendForm } from './ResendForm';

export const dynamic = 'force-dynamic';

export default async function Bw6ResendPage({ searchParams }: { searchParams: Promise<{ ev?: string; pv?: string }> }) {
  const ctx = await getRecitalPublicContext(await searchParams);
  if (!ctx.event) {
    return <p className="py-10 text-center text-navy-700">準備中です</p>;
  }
  const lineUrl = ctx.settings.line_url;
  return (
    <main className="space-y-6 text-navy-700">
      <Link href={`/bw6${ctx.qs}`} className="inline-block text-sm font-bold text-navy-700 underline">
        ← 発表会のページ
      </Link>
      <h1 className="text-xl font-bold">マイページのURLを送ります</h1>
      <ResendForm eventKey={ctx.eventKey} pv={ctx.pv} />
      <section className="space-y-3 rounded-xl border border-sand-200 bg-white p-4">
        <p className="text-sm leading-relaxed">控えが届かないときは、公式LINEでお知らせください。</p>
        {lineUrl && (
          <a
            href={lineUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center font-bold text-navy-700"
          >
            公式LINE
          </a>
        )}
      </section>
    </main>
  );
}
