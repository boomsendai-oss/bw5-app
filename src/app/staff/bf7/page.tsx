// スタッフ: vol.7 ウェイトリストの一覧。/staff/* 配下なのでproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { countBf7Notify, listBf7Notify } from '@/lib/bf7Db';
import { BF7_DIVISIONS } from '@/lib/bf7';

export const dynamic = 'force-dynamic';

export default async function StaffBf7Page() {
  const [counts, rows] = await Promise.all([countBf7Notify(), listBf7Notify()]);
  const label = (k: string) => BF7_DIVISIONS.find((d) => d.key === k)?.label ?? k;

  return (
    <div>
      <StaffPageHeader
        title="BF7 ウェイトリスト"
        description="vol.7(2027/1/30)のエントリー開始を知らせる名簿"
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-2xl bg-navy-900 p-4 text-white">
            <p className="text-xs font-bold text-sand-300">登録</p>
            <p className="mt-1 text-2xl font-black tabular-nums">{counts.total}</p>
          </div>
          {BF7_DIVISIONS.map((d) => (
            <div key={d.key} className="rounded-2xl border border-sand-300 bg-white p-4">
              <p className="text-xs font-bold text-neutral-500">{d.label}希望</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-navy-900">{counts.byDivision[d.key] ?? 0}</p>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="rounded-2xl border border-sand-300 bg-white p-6 text-sm font-bold text-neutral-500">
            まだ登録はありません。
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-sand-300 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-sand-100 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-black">#</th>
                  <th className="px-3 py-2 text-left font-black">お名前</th>
                  <th className="px-3 py-2 text-left font-black">メール</th>
                  <th className="px-3 py-2 text-left font-black">希望部門</th>
                  <th className="px-3 py-2 text-left font-black">登録日</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-sand-200 text-navy-900">
                    <td className="px-3 py-2 tabular-nums text-neutral-500">{r.id}</td>
                    <td className="px-3 py-2 font-bold">{r.name}</td>
                    <td className="px-3 py-2 text-neutral-700">{r.email}</td>
                    <td className="px-3 py-2 text-neutral-700">
                      {r.divisions.length ? r.divisions.map(label).join('・') : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-neutral-500">{r.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
