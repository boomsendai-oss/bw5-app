// ⚠️ 公開ページ(認証なし)。理由: BW6 発表会の料金の早見(家庭がだれでも見られる)。
// 出すのは公開情報(料金の規則から出した金額・設定の日付・このほかにかかるもの)だけで、申込の中身は出さない。
// 12/15 は表だけ（「金額を試す」は段階2）。
import Link from 'next/link';
import { FeeTable } from '@/components/recital/FeeTable';
import { listFeeRules } from '@/lib/recitalDb';
import { feeTableFromRules } from '@/lib/recitalPublic';
import { getRecitalPublicContext } from '../context';

export const dynamic = 'force-dynamic';

export default async function Bw6FeePage({ searchParams }: { searchParams: Promise<{ ev?: string; pv?: string }> }) {
  const ctx = await getRecitalPublicContext(await searchParams);
  const { event, settings: s, qs } = ctx;
  const rules = event ? await listFeeRules(ctx.eventKey) : [];
  if (!event || rules.length === 0) {
    return <p className="py-10 text-center text-navy-700">準備中です</p>;
  }
  const table = feeTableFromRules(rules, s.max_works_per_person);

  return (
    <main className="space-y-6 text-navy-700">
      {ctx.preview && (
        <p className="rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-bold text-white">試し用の表示です</p>
      )}
      <Link href={`/bw6${qs}`} className="inline-block text-sm font-bold text-navy-700 underline">
        ← 発表会のページ
      </Link>
      <header>
        <p className="text-sm font-bold text-brand-700">{event.title}</p>
        <h1 className="mt-1 text-2xl font-bold">料金の早見</h1>
      </header>
      <FeeTable table={table} payDue={s.pay_due} extraCostsText={s.extra_costs_text} />
    </main>
  );
}
