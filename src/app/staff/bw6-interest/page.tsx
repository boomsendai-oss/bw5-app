// スタッフ: BW6プレ告知LP(boom-sendai.com/bw6)の「出てみたい／ちょっと気になる」集計。
// /staff/* 配下のためproxy認証で保護(規約4.5)。数は端末単位(同じスマホの押し直しは1件)。
import StaffPageHeader from '@/components/StaffPageHeader';
import {
  BW6_AGE_LABEL,
  BW6_KIND_LABEL,
  BW6_SRC_LABEL,
  listBw6Interest,
  summarizeBw6,
  type Bw6AgeGroup,
} from '@/lib/bw6Interest';

export const dynamic = 'force-dynamic';

function jst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default async function StaffBw6InterestPage() {
  const rows = await listBw6Interest();
  const sum = summarizeBw6(rows);
  const named = rows.filter((r) => r.name || r.classLabel || r.ageGroup);
  const fetchedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  return (
    <div>
      <StaffPageHeader
        title="BW6 出てみたい集計"
        description={`プレ告知LP boom-sendai.com/bw6 のボタン記録(端末単位) ・ ${fetchedAt} 時点`}
      />
      <div className="mx-auto max-w-5xl space-y-6 p-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="押した端末(合計)" value={`${sum.total}`} />
          <Card label={BW6_KIND_LABEL.want} value={`${sum.byKind.want}`} />
          <Card label={BW6_KIND_LABEL.curious} value={`${sum.byKind.curious}`} />
          <Card label="名前などを入れた" value={`${sum.withName}`} sub={`クラス/年代だけも含め ${named.length}`} />
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">流入元別</h2>
          <p className="mt-1 text-xs text-neutral-500">URLの ?src= で判定。最初に来た経路で数える</p>
          {sum.bySrc.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">まだありません</p>
          ) : (
            <table className="mt-3 w-full text-sm text-navy-900">
              <thead>
                <tr className="border-b border-sand-200 text-left text-xs text-neutral-500">
                  <th className="py-1">流入元</th>
                  <th className="py-1 text-right">出てみたい</th>
                  <th className="py-1 text-right">気になる</th>
                  <th className="py-1 text-right">計</th>
                </tr>
              </thead>
              <tbody>
                {sum.bySrc.map((s) => (
                  <tr key={s.src} className="border-b border-sand-100">
                    <td className="py-1.5">
                      {BW6_SRC_LABEL[s.src] ?? s.src} <span className="text-xs text-neutral-400">{s.src}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{s.want}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.curious}</td>
                    <td className="py-1.5 text-right font-bold tabular-nums">{s.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">名前などを入れてくれた人({named.length}件)</h2>
          <p className="mt-1 text-xs text-neutral-500">申込ではありません。先生からの声かけ用</p>
          {named.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">まだありません</p>
          ) : (
            <ul className="mt-3 divide-y divide-sand-100">
              {named.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm text-navy-900">
                  <span className="font-bold">{r.name || '(名前なし)'}</span>
                  <span>{r.classLabel || 'クラス未記入'}</span>
                  <span className="text-xs text-neutral-500">
                    {r.ageGroup ? BW6_AGE_LABEL[r.ageGroup as Bw6AgeGroup] ?? r.ageGroup : '年代未記入'}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${r.kind === 'want' ? 'bg-brand-100 text-brand-800' : 'bg-sand-100 text-navy-700'}`}
                  >
                    {BW6_KIND_LABEL[r.kind]}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {BW6_SRC_LABEL[r.src] ?? r.src} ・ {jst(r.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">押された順(新しい順・最大200件)</h2>
          <ul className="mt-2 divide-y divide-sand-100 text-xs text-navy-900">
            {rows.slice(0, 200).map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="tabular-nums text-neutral-500">{jst(r.createdAt)}</span>
                <span>{BW6_KIND_LABEL[r.kind]}</span>
                <span className="text-neutral-500">{BW6_SRC_LABEL[r.src] ?? r.src}</span>
                <span className="text-neutral-400">{r.userAgent}</span>
                {r.pressCount > 1 && <span className="text-neutral-400">押し直し{r.pressCount - 1}回</span>}
                {r.firstKind !== r.kind && <span className="text-neutral-400">最初は「{BW6_KIND_LABEL[r.firstKind]}」</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-navy-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
