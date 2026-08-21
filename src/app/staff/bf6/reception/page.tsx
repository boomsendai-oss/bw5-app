// スタッフ: BF6 当日受付(チェックイン+くじ引き)。/staff/* 配下のためproxy認証で保護(規約4.5)。
//
// くじ引きは2回に分かれる(TARO確定 2026-08-21):
//   ?phase=block   … 受付時。ビギナーはトーナメント位置、小中/一般はA/Bブロック
//   ?phase=bracket … 予選終了後。小中/一般の通過者がベスト8の位置を引く
import StaffPageHeader from '@/components/StaffPageHeader';
import Link from 'next/link';
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { ReceptionClient } from './ReceptionClient';
import { SlotSeeder } from './SlotSeeder';
import type { Bf6DrawPhase } from '@/lib/bf6Draw';

export const dynamic = 'force-dynamic';

export default async function StaffBf6ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string }>;
}) {
  const { phase: raw } = await searchParams;
  const phase: Bf6DrawPhase = raw === 'bracket' ? 'bracket' : 'block';
  const entrants = await listBf6ReceptionEntrants();

  // ビギナーは受付時にトーナメント位置まで引くので、blockフェーズでもbracketを使う
  const forPhase = entrants.map((e) => ({
    ...e,
    divisions:
      phase === 'bracket' ? e.divisions.filter((d) => d !== 'beginner') : e.divisions,
  })).filter((e) => e.divisions.length > 0);

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

        <SlotSeeder phase={phase} />
        <ReceptionClient entrants={forPhase} phase={phase} />
      </div>
    </div>
  );
}
