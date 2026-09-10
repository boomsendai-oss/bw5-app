// クルー: 顔写真の撮影。部門ごとのタブで、撮るべき人だけを出す。
//
// ⚠️ 全員を一覧に出してはいけない(TARO 2026-09-09)。
//   ビギナー   … 受付でトーナメント位置まで決まるので全員撮る
//   小中・一般 … 「予選通過者」でチェックされた8名だけ撮る(くじ引き②を待たなくてよい)。
//               それまでは「まだ予選通過者が決まっていません」でリストを出さない。
import Link from 'next/link';
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6PhotoItemIds } from '@/lib/bf6PhotoDb';
import { listBf6Qualifiers } from '@/lib/bf6QualifierDb';
import CrewHeader from '../CrewHeader';
import PhotoList, { type PhotoRow } from './PhotoList';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'beginner', label: 'ビギナー' },
  { key: 'kids', label: '小中学生' },
  { key: 'general', label: '一般' },
] as const;
type Div = (typeof TABS)[number]['key'];

export default async function CrewPhotoPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string }>;
}) {
  const { division: raw } = await searchParams;
  const division: Div = TABS.some((t) => t.key === raw) ? (raw as Div) : 'beginner';

  const [entrants, photoIds, qualifiers] = await Promise.all([
    listBf6ReceptionEntrants(),
    listBf6PhotoItemIds(),
    listBf6Qualifiers(),
  ]);

  // その部門で「撮るべき人」。小中・一般は予選通過者(くじ引き②を待たずに撮り始められる)
  const target = entrants.filter((e) =>
    division === 'beginner'
      ? e.divisions.includes('beginner')
      : (qualifiers[division]?.has(e.itemId) ?? false)
  );

  const rows: PhotoRow[] = target
    .map((e) => ({
      itemId: e.itemId,
      dancerName: e.dancerName,
      divisions: e.divisions,
      hasPhoto: photoIds.has(e.itemId),
      slots: e.draws
        .filter((d) => d.phase === 'bracket')
        .map((d) => ({ division: d.division, slotNo: d.slotNo })),
    }))
    // 枠番号順(未抽選は最後)にすると、トーナメント表の順に撮れる
    .sort((a, b) => {
      const sa = a.slots.find((s) => s.division === division)?.slotNo ?? 999;
      const sb = b.slots.find((s) => s.division === division)?.slotNo ?? 999;
      return sa - sb;
    });

  const qualifiersUndecided = division !== 'beginner' && rows.length === 0;

  return (
    <div>
      <CrewHeader title="写真撮影" description="VS画面に出す顔写真" />
      <div className="mx-auto max-w-2xl p-4">
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/bf6/crew/photo?division=${t.key}`}
              className={`flex-1 rounded-xl py-3 text-center text-sm font-black transition active:scale-95 ${
                t.key === division ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-600'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {qualifiersUndecided ? (
          <div className="rounded-2xl border border-sand-200 bg-white p-6 text-center">
            <p className="text-lg font-black text-navy-900">まだ予選通過者が決まっていません</p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">
              {TABS.find((t) => t.key === division)?.label}部門は、予選を通過した8名だけ撮影します。
              <br />
              予選が終わったら「予選通過者」でチェックしてください。チェックした人がここに出ます。
            </p>
            <Link
              href={`/bf6/crew/qualifiers?division=${division}`}
              className="mt-4 inline-block rounded-xl bg-sand-100 px-4 py-2 text-sm font-bold text-navy-700"
            >
              予選通過者をチェックする
            </Link>
          </div>
        ) : (
          <PhotoList rows={rows} division={division} />
        )}
      </div>
    </div>
  );
}
