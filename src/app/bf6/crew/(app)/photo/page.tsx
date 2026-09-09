// クルー: 顔写真の撮影。部門ごとのタブで、撮るべき人だけを出す。
//
// ⚠️ 全員を一覧に出してはいけない(TARO 2026-09-09)。
//   ビギナー   … 受付でトーナメント位置まで決まるので全員撮る
//   小中・一般 … 予選を通過してベスト8のくじ(くじ引き②)を引いた人だけ撮る。
//               それまでは「まだ予選通過者が決まっていません」でリストを出さない。
// 予選通過の判定は bf_draw の phase='bracket' に枠があるかどうか(くじ引き②と連動)。
import Link from 'next/link';
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6PhotoItemIds } from '@/lib/bf6PhotoDb';
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

  const [entrants, photoIds] = await Promise.all([
    listBf6ReceptionEntrants(),
    listBf6PhotoItemIds(),
  ]);

  // その部門で「撮るべき人」とトーナメント枠番号
  const slotOf = (e: (typeof entrants)[number]) =>
    e.draws.find((d) => d.division === division && d.phase === 'bracket')?.slotNo ?? null;
  const target = entrants.filter((e) =>
    division === 'beginner' ? e.divisions.includes('beginner') : slotOf(e) !== null
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
              className={`flex-1 rounded-xl py-3 text-center text-sm font-black ${
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
              予選が終わったら「くじ引き②(ベスト8)」を行ってください。引いた人がここに出ます。
            </p>
            <Link
              href="/bf6/crew/reception?phase=bracket"
              className="mt-4 inline-block rounded-xl bg-sand-100 px-4 py-2 text-sm font-bold text-navy-700"
            >
              くじ引き②(ベスト8)へ
            </Link>
          </div>
        ) : (
          <PhotoList rows={rows} division={division} />
        )}
      </div>
    </div>
  );
}
