// スタッフ: BF6 当日受付(チェックイン+くじ引き)。/staff/* 配下のためproxy認証で保護(規約4.5)。
//
// くじ引きは2回に分かれる(TARO確定 2026-08-21):
//   ?phase=block   … 受付時。ビギナーはトーナメント位置、小中/一般はA/Bブロック
//   ?phase=bracket … 予選終了後。小中/一般の通過者がベスト8の位置を引く
import StaffPageHeader from '@/components/StaffPageHeader';
import Link from 'next/link';
import { ensureBf6ReceptionSlots, listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6PhotoItemIds } from '@/lib/bf6PhotoDb';
import { listBf6Qualifiers } from '@/lib/bf6QualifierDb';
import { filterForBracketDraw, QUALIFIER_COUNT } from '@/lib/bf6Qualifier';
import { ReceptionClient } from './ReceptionClient';
import type { Bf6DrawPhase } from '@/lib/bf6Draw';

export const dynamic = 'force-dynamic';

export default async function StaffBf6ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string; d?: string }>;
}) {
  // d = 開いておく部門のタブ(端末ごとに担当部門を固定できる)
  const { phase: raw, d } = await searchParams;
  const phase: Bf6DrawPhase = raw === 'bracket' ? 'bracket' : 'block';
  // くじの枠は開くたびに自動で用意する(締切まで人数が増えるため。減らさない)
  await ensureBf6ReceptionSlots(phase);
  const [entrants, photoIds, qualifiers] = await Promise.all([
    listBf6ReceptionEntrants(),
    listBf6PhotoItemIds(),
    listBf6Qualifiers(),
  ]);

  // ビギナーは受付時にトーナメント位置まで引くので、blockフェーズでもbracketを使う
  // くじ引き②(ベスト8)は、予選通過者としてチェックされた人だけ(押し間違い防止・TARO 2026-09-09)。
  const forPhase = phase === 'bracket' ? filterForBracketDraw(entrants, qualifiers) : entrants;
  // 部門ごとの通過者の状況。「8名そろっていません」だけだと、片方を終えた直後でも
  // 警告が出て何が足りないか分からない(TARO実機 2026-09-10)。数で見せる。
  const qualifierStatus =
    phase === 'bracket'
      ? (['kids', 'general'] as const).map((d) => ({
          key: d,
          label: d === 'kids' ? '小中学生' : '一般',
          count: qualifiers[d]?.size ?? 0,
        }))
      : [];

  return (
    <div>
      <StaffPageHeader
        title="当日受付"
        description={phase === 'block' ? '13:30-14:00 チェックイン+くじ引き①' : '予選終了後 くじ引き②(ベスト8)'}
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        <div className="flex gap-2">
          <Link
            href="/staff/bf6/reception?phase=block"
            className={`flex-1 rounded-xl py-3 text-center text-sm font-black ${
              phase === 'block' ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-600'
            }`}
          >
            ① 受付時
          </Link>
          <Link
            href="/staff/bf6/reception?phase=bracket"
            className={`flex-1 rounded-xl py-3 text-center text-sm font-black ${
              phase === 'bracket' ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-600'
            }`}
          >
            ② 予選後(ベスト8)
          </Link>
        </div>

        {qualifierStatus.length > 0 && (
          <div className="rounded-xl border border-sand-300 bg-white p-3">
            <p className="text-xs font-bold text-neutral-500">予選通過者の登録状況</p>
            <ul className="mt-2 space-y-1">
              {qualifierStatus.map((q) => (
                <li key={q.key} className="flex items-center justify-between text-sm">
                  <span className="font-bold text-navy-900">{q.label}</span>
                  <span
                    className={`font-black ${
                      q.count === QUALIFIER_COUNT ? 'text-brand-600' : 'text-neutral-400'
                    }`}
                  >
                    {q.count} / {QUALIFIER_COUNT} 名
                    {q.count === QUALIFIER_COUNT ? ' ✓' : ' 未登録'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-neutral-500">
              下の一覧には、登録済みの通過者だけが出ます。まだの部門は「予選通過者」でチェックしてください。
            </p>
          </div>
        )}
        <ReceptionClient entrants={forPhase} phase={phase} photoItemIds={[...photoIds]} initialDivision={d} />
      </div>
    </div>
  );
}
