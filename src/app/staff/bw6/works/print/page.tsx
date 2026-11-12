// スタッフ：BW6 発表会の「作品の想定一覧」（資料53）。A4 縦・1作品1行。取りやめた作品は出さない。
// 12/3〜12/7 にイントラの LINE グループに貼る・12/11 の照明の打ち合わせに持って行く。
// 人数を出すので、proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。
// 印刷ではヘッダー・ボタン・スタッフのサイドバーを隠す（下地は白・字は黒）。
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import PrintButton from '@/app/bw6/guide/PrintButton';
import { todayJst } from '@/lib/dateJst';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { pickStaffEventKey } from '@/lib/recital';
import { listWorkCounts, listWorkLinks, listWorks, type WorkRow } from '@/lib/recitalDb';
import { WORK_KIND_LABEL } from '../../labels';

export const dynamic = 'force-dynamic';

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const codeNo = (c: string) => {
  const m = /^W(\d+)$/.exec(c);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

function byOrder(a: WorkRow, b: WorkRow): number {
  return a.sort_order - b.sort_order || codeNo(a.work_code) - codeNo(b.work_code) || a.work_code.localeCompare(b.work_code);
}

/** JST の今日 → 「M月D日」 */
function jstMonthDay(now: Date): string {
  const [, m, d] = todayJst(now).split('-');
  return `${Number(m)}月${Number(d)}日`;
}

// スタッフのレイアウトのサイドバーとヘッダーは印刷に出さない。A4 縦
const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  [data-slot="sidebar"], [data-slot="sidebar-gap"], [data-slot="sidebar-container"], header { display: none !important; }
  html, body { background: #fff !important; }
}
`;

export default async function StaffBw6WorksPrintPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const ev = pickStaffEventKey(first(sp.ev));
  const [works, counts, links] = await Promise.all([listWorks(ev), listWorkCounts(ev), listWorkLinks(ev)]);
  const rows = works.filter((w) => w.status !== 'dropped').sort(byOrder);

  return (
    <div className="bg-white text-black">
      <style>{PRINT_CSS}</style>
      <div className="print:hidden">
        <StaffPageHeader
          title="作品の想定一覧（印刷用）"
          description={`BW6 発表会（${ev}）`}
          backHref={`/staff/bw6/works?ev=${encodeURIComponent(ev)}`}
          backLabel="作品"
        />
      </div>
      <main className="mx-auto max-w-[190mm] p-4 print:max-w-none print:p-0">
        <div className="mb-4 print:hidden">
          <PrintButton />
        </div>
        <h1 className="text-lg font-bold">作品の想定一覧（{jstMonthDay(new Date())} 時点）</h1>
        {rows.length === 0 ? (
          <p className="mt-4 text-sm">作品は、まだありません。</p>
        ) : (
          <table className="mt-3 w-full border-collapse text-left text-[11px] leading-snug">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="px-1 py-1 whitespace-nowrap">W番号</th>
                <th className="px-1 py-1">名前</th>
                <th className="px-1 py-1 whitespace-nowrap">種類</th>
                <th className="px-1 py-1">クラス</th>
                <th className="px-1 py-1">担当</th>
                <th className="px-1 py-1">対象</th>
                <th className="px-1 py-1 whitespace-nowrap">今の人数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const c = counts.get(w.id);
                const cls = (links.get(w.id)?.classes ?? []).map((x) => x.label).filter(Boolean);
                const ins = (links.get(w.id)?.instructors ?? []).map((x) => x.display_name);
                return (
                  <tr key={w.id} className="border-b border-black/40 break-inside-avoid">
                    <td className="px-1 py-1 font-mono whitespace-nowrap">{w.work_code}</td>
                    <td className="px-1 py-1 break-words">{w.title}</td>
                    <td className="px-1 py-1 whitespace-nowrap">{WORK_KIND_LABEL[w.kind] ?? w.kind}</td>
                    <td className="px-1 py-1 break-words">{cls.length > 0 ? cls.join('・') : (w.class_label ?? '')}</td>
                    <td className="px-1 py-1 break-words">{ins.join('・')}</td>
                    <td className="px-1 py-1 break-words">{w.target_label ?? ''}</td>
                    <td className="px-1 py-1 whitespace-nowrap">出る {c?.in ?? 0}／迷っている {c?.maybe ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
