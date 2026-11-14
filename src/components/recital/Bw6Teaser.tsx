// BW6 発表会の公開ページ（/bw6）の予告と、モッチンさんナンバーの案内（2026-11-14 TARO：インスタのハイライトから /bw6 へつなぐため）。
// 本番の発表会（bw6）の行を入れる前（〜12/13）は、予告だけを出す。行が入ったあとの受付前（12/13〜12/15）も、ナンバーの案内を出す。
// 出すのは公開済みの情報だけ（日程・会場・受付開始日・モッチンさんナンバーの締切）。
import Link from 'next/link';
import { MOCCHIN_DEADLINE, mocchinGate } from '@/lib/mocchinEntry';

export const BW6_TEASER = {
  title: 'BOOM WOP vol.6',
  date: '2027年4月11日(日)',
  venue: '仙台市若林区文化センター ホール',
  entryOpen: '12月15日(火)',
  lineUrl: 'https://lin.ee/4EYB9zZ',
} as const;

/** 'YYYY-MM-DD' → 「12月13日(日)」 */
export function jpMonthDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${wd})`;
}

/** モッチンさんナンバーの申込を受けている間だけ true（会員の先行期間もふくむ） */
export function mocchinOpenForTeaser(today: string): boolean {
  const g = mocchinGate(today);
  return g === 'member' || g === 'open';
}

export function MocchinBox({ today }: { today: string }) {
  if (!mocchinOpenForTeaser(today)) return null;
  return (
    <section className="rounded-xl border-2 border-brand-600 bg-white px-4 py-4">
      <p className="text-xs font-bold text-brand-700">参加者 募集中</p>
      <h2 className="mt-1 text-lg font-bold">スペシャルナンバー by MOCCHIN</h2>
      <p className="mt-2 text-sm">
        D&apos;OAM の MOCCHIN さんが振付するスペシャルナンバーです。申込の締切は {jpMonthDay(MOCCHIN_DEADLINE)} です。
      </p>
      <Link href="/mocchin" className="mt-3 block w-full rounded-xl bg-brand-600 px-4 py-3 text-center font-bold text-white">
        くわしく見る・申し込む
      </Link>
    </section>
  );
}

export function Bw6Teaser({ today }: { today: string }) {
  return (
    <main className="space-y-6 text-navy-700">
      <header>
        <p className="text-sm font-bold text-brand-700">BOOMダンススクール 発表会</p>
        <h1 className="mt-1 text-2xl font-bold">{BW6_TEASER.title}</h1>
      </header>

      <dl className="rounded-xl border border-sand-200 bg-white px-4 py-2 text-sm">
        <div className="flex gap-3 border-b border-sand-200 py-2">
          <dt className="w-24 shrink-0 font-bold">日時</dt>
          <dd>{BW6_TEASER.date}</dd>
        </div>
        <div className="flex gap-3 py-2">
          <dt className="w-24 shrink-0 font-bold">会場</dt>
          <dd>{BW6_TEASER.venue}</dd>
        </div>
      </dl>

      <div className="rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-center text-navy-700">
        <p className="text-sm font-bold">出演の申込は</p>
        <p className="mt-1 text-xl font-bold">{BW6_TEASER.entryOpen}から</p>
        <p className="mt-1 text-sm">このページで受け付けます</p>
      </div>

      <MocchinBox today={today} />

      <p className="text-center text-sm">
        受付が始まったら、
        <a href={BW6_TEASER.lineUrl} target="_blank" rel="noreferrer noopener" className="font-bold underline">
          BOOMの公式LINE
        </a>
        でお知らせします。
      </p>
    </main>
  );
}
