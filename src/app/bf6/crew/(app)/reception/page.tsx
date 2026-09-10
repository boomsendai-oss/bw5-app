// クルー: 当日受付(チェックイン+くじ引き)。中身は /staff/bf6/reception と同じ部品を使う。
//
// くじ引きは2回に分かれる(TARO確定 2026-08-21):
//   ?phase=block   … 受付時。ビギナーはトーナメント位置、小中/一般はA/Bブロック
//   ?phase=bracket … 予選終了後。小中/一般の通過者がベスト8の位置を引く
import Link from 'next/link';
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6PhotoItemIds } from '@/lib/bf6PhotoDb';
import { listBf6Qualifiers } from '@/lib/bf6QualifierDb';
import { filterForBracketDraw, QUALIFIER_COUNT } from '@/lib/bf6Qualifier';
import { ReceptionClient } from '@/app/staff/bf6/reception/ReceptionClient';
import { SlotSeeder } from '@/app/staff/bf6/reception/SlotSeeder';
import CrewHeader from '../CrewHeader';
import type { Bf6DrawPhase } from '@/lib/bf6Draw';

export const dynamic = 'force-dynamic';

export default async function CrewReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string }>;
}) {
  const { phase: raw } = await searchParams;
  const phase: Bf6DrawPhase = raw === 'bracket' ? 'bracket' : 'block';
  const [entrants, photoIds, qualifiers] = await Promise.all([
    listBf6ReceptionEntrants(),
    listBf6PhotoItemIds(),
    listBf6Qualifiers(),
  ]);

  // くじ引き②(ベスト8)は、予選通過者としてチェックされた人だけ(押し間違い防止・TARO 2026-09-09)。
  // ビギナーは受付時にトーナメント位置まで引くので、bracketフェーズには出ない。
  const forPhase = phase === 'bracket' ? filterForBracketDraw(entrants, qualifiers) : entrants;
  const shortage =
    phase === 'bracket'
      ? (['kids', 'general'] as const).filter((d) => (qualifiers[d]?.size ?? 0) !== QUALIFIER_COUNT)
      : [];

  return (
    <div>
      <CrewHeader
        title={phase === 'block' ? '受付・くじ引き①' : 'くじ引き②(ベスト8)'}
        description={phase === 'block' ? '13:30-14:00 チェックイン+抽選' : '予選終了後の抽選'}
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        <div className="flex gap-2">
          <Link
            href="/bf6/crew/reception?phase=block"
            className={`flex-1 rounded-xl py-3 text-center text-sm font-black transition active:scale-95 ${
              phase === 'block' ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-600'
            }`}
          >
            ① 受付時
          </Link>
          <Link
            href="/bf6/crew/reception?phase=bracket"
            className={`flex-1 rounded-xl py-3 text-center text-sm font-black transition active:scale-95 ${
              phase === 'bracket' ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-600'
            }`}
          >
            ② 予選後(ベスト8)
          </Link>
        </div>

        {shortage.length > 0 && (
          <div className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-black">予選通過者が {QUALIFIER_COUNT} 名そろっていません</p>
            <p className="mt-1 text-xs">
              {shortage.map((d) => (d === 'kids' ? '小中学生' : '一般')).join('・')}:
              「予選通過者」でチェックしてから、くじ引き②を行ってください。
            </p>
          </div>
        )}
        <SlotSeeder phase={phase} />
        <ReceptionClient entrants={forPhase} phase={phase} photoItemIds={[...photoIds]} />
      </div>
    </div>
  );
}
