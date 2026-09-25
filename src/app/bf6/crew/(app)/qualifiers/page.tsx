// クルー: ブロック予選(小中・一般)。並び順の確認と、通過者のチェックを1画面で行う。
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

  // その部門にエントリーしている人。受付でA/Bブロックを引いていればブロックも出す。
  // ジャンルも渡す: 係が並び順を紙に書き写すとき、名前だけだと誰か特定しきれない(TARO 2026-09-25)
  const candidates: Candidate[] = entrants
    .filter((e) => e.divisions.includes(division))
    .map((e) => {
      const draw = e.draws.find((d) => d.division === division && d.phase === 'block');
      return {
        itemId: e.itemId,
        dancerName: e.dancerName,
        genre: e.genre,
        block: draw?.block ?? null,
        drawnAt: draw?.drawnAt ?? null,
      };
    })
    .sort((a, b) => a.dancerName.localeCompare(b.dancerName, 'ja'));

  return (
    <div>
      <CrewHeader title="ブロック予選" description="並び順を見ながら並ばせて、通過した8名をチェック" />
      <div className="mx-auto max-w-3xl p-4">
        <div className="mb-4 flex gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/bf6/crew/qualifiers?division=${t.key}`}
              className={`flex-1 rounded-xl py-3 text-center text-sm font-black transition active:scale-95 ${
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
