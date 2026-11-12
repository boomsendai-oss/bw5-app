// ⚠️ 公開ページ(認証なし)。理由: BW6 発表会の出演のご案内(家庭がだれでも読める・印刷できる)。
// 出すのは公開情報(案内の文・設定の日付と金額・料金の早見)だけで、申込の中身は出さない。
// 文は設計書 7-9 の表の11行を、この順で、文のまま出す（7-6：問いかけの見出し・チェックの列挙・あおる言い方は使わない）。
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FiveLines } from '@/components/recital/FiveLines';
import { FeeTable } from '@/components/recital/FeeTable';
import { listFeeRules } from '@/lib/recitalDb';
import { feeTableFromRules, fiveLines, jpDate, slashDate } from '@/lib/recitalPublic';
import { getRecitalPublicContext } from '../context';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-1 text-base font-bold">{title}</h2>
      <div className="space-y-1 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export default async function Bw6GuidePage({ searchParams }: { searchParams: Promise<{ ev?: string; pv?: string }> }) {
  const ctx = await getRecitalPublicContext(await searchParams);
  const { event, settings: s, qs } = ctx;
  if (!event) {
    return <p className="py-10 text-center text-navy-700">準備中です</p>;
  }
  const rules = await listFeeRules(ctx.eventKey);
  const table = rules.length > 0 ? feeTableFromRules(rules, s.max_works_per_person) : null;

  return (
    <main className="space-y-6 text-navy-700">
      {ctx.preview && (
        <p className="rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-bold text-white print:hidden">試し用の表示です</p>
      )}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/bw6${qs}`} className="text-sm font-bold text-navy-700 underline">
          ← 発表会のページ
        </Link>
        <PrintButton />
      </div>

      <header>
        <p className="text-sm font-bold text-brand-700">{event.title}</p>
        <h1 className="mt-1 text-2xl font-bold">出演のご案内</h1>
        <p className="mt-1 text-sm">
          {jpDate(event.show_date)}
          {event.venue ? `・${event.venue}` : ''}
        </p>
      </header>

      {/* 1 お金の決まり */}
      <FiveLines lines={fiveLines(s)} />

      {/* 2 振りを見てから決めたい人（5-12 と同じ文） */}
      <Part title="振りを見てから決めたい方">
        <p>
          振りを見てから決めたい方は、『まだ迷っている』を選んでお申し込みください。{slashDate(s.change_close_at)}までに、マイページで『出る』に変えられます。お支払いは、決まってからで大丈夫です。期限は {jpDate(s.pay_due)}です。
        </p>
      </Part>

      {/* 3 合同 */}
      <Part title="合同の作品">
        <p>人数が少ないクラスは、他のクラスと合同での作品制作になる場合があります</p>
      </Part>

      {/* 4 名前と写真の使い道（同意の文6 と同じ文） */}
      <Part title="お名前と写真の使い道">
        <p>お名前は、パンフレットとエンドロールに載ります。写真と映像は、パンフレットと、当日会場で流す映像・記録の映像に使います。</p>
      </Part>

      {/* 5 スクールのSNS */}
      <Part title="スクールのSNS">
        <p>発表会の写真や映像は、スクールのSNS（Instagram など）でも使わせていただきます。事情のある方は、公式LINEでお知らせください。</p>
      </Part>

      {/* 6 「よくある質問」の1行 */}
      <Part title="よくある質問">
        <p>パンフレットや映像に、名前や写真を載せられない事情があるときは、公式LINEでご相談ください。</p>
      </Part>

      {/* 7 出られる人（7-9 の文のまま） */}
      <Part title="出られる方">
        <p>12月11日（金）より後にご入会の方も、お申し込みいただけます。</p>
      </Part>

      {/* 8 払い方（5-6 の一言と同じ） */}
      <Part title="お支払いの方法">
        <p>お支払いは、カードか銀行振込で、{jpDate(s.pay_due)}までにお願いします。銀行振込のときの振込手数料は、ご負担をお願いします。</p>
        <p>カードも振込もむずかしいときは、公式LINEでご相談ください。</p>
      </Part>

      {/* 9 家族（フォームのはじめと同じ文） */}
      <Part title="ごきょうだい・ご家族">
        <p>ごきょうだい・ご家族は、1回のお申し込みで、まとめて入れてください。別々に申し込むと、料金が高くなります。</p>
      </Part>

      {/* 10 なくなった作品（短い5行の5つめ） */}
      <Part title="作品がなくなったとき">
        <p>スクールの都合で作品がなくなったときは、その分をお返しします。</p>
      </Part>

      {/* 11 このほかにかかるもの（設定 extra_costs_text。空のあいだは出さない） */}
      {s.extra_costs_text.trim() !== '' && (
        <Part title="このほかにかかるもの">
          <p className="whitespace-pre-wrap">{s.extra_costs_text}</p>
        </Part>
      )}

      {/* 料金の早見（このほかにかかるものは上に出したので、ここでは重ねない） */}
      <section className="break-inside-avoid">
        <h2 className="mb-2 text-lg font-bold">料金の早見</h2>
        {table ? <FeeTable table={table} payDue={s.pay_due} extraCostsText="" /> : <p className="text-sm">準備中です</p>}
      </section>
    </main>
  );
}
