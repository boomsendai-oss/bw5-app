// クルー: 予選通過者のチェック(小中・一般)。
//
// くじ引き②(ベスト8)の一覧に部門の全員を出すと押し間違いが起きるため、
// 先にここで通過した8名を選び、くじ引き②と写真撮影はその8名だけに絞る(TARO 2026-09-09)。
// 通過者の記録としても残る。
import Link from 'next/link';
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6Qualifiers } from '@/lib/bf6QualifierDb';
import { hasQualifierStage } from '@/lib/bf6Qualifier';
import CrewHeader from '../CrewHeader';
import QualifierPicker, { type Candidate } from './QualifierPicker';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'kids', label: '小中学生' },
  { key: 'general', label: '一般' },
] as const;

export default async function CrewQualifiersPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string }>;
}) {
  const { division: raw } = await searchParams;
  const division = hasQualifierStage(raw ?? '') ? (raw as 'kids' | 'general') : 'kids';
  const label = TABS.find((t) => t.key === division)!.label;

  const [entrants, qualifiers] = await Promise.all([listBf6ReceptionEntrants(), listBf6Qualifiers()]);

  // その部門にエントリーしている人。受付でA/Bブロックを引いていればブロックも出す
  const candidates: Candidate[] = entrants
    .filter((e) => e.divisions.includes(division))
    .map((e) => ({
      itemId: e.itemId,
      dancerName: e.dancerName,
      block: e.draws.find((d) => d.division === division && d.phase === 'block')?.block ?? null,
    }))
    .sort((a, b) => a.dancerName.localeCompare(b.dancerName, 'ja'));

  return (
    <div>
      <CrewHeader title="予選通過者" description="予選が終わったら、通過した8名をチェック" />
      <div className="mx-auto max-w-2xl p-4">
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/bf6/crew/qualifiers?division=${t.key}`}
              className={`flex-1 rounded-xl py-3 text-center text-sm font-black ${
                t.key === division ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-600'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <QualifierPicker
          key={division}
          division={division}
          divisionLabel={label}
          candidates={candidates}
          initialSelected={[...(qualifiers[division] ?? [])]}
        />
      </div>
    </div>
  );
}
