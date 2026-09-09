// クルー: 顔写真の撮影だけをする画面。受付とは別の人・別の端末で回せるように切り出した。
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6PhotoItemIds } from '@/lib/bf6PhotoDb';
import CrewHeader from '../CrewHeader';
import PhotoList, { type PhotoRow } from './PhotoList';

export const dynamic = 'force-dynamic';

export default async function CrewPhotoPage() {
  const [entrants, photoIds] = await Promise.all([
    listBf6ReceptionEntrants(),
    listBf6PhotoItemIds(),
  ]);

  const rows: PhotoRow[] = entrants.map((e) => ({
    itemId: e.itemId,
    dancerName: e.dancerName,
    divisions: e.divisions,
    hasPhoto: photoIds.has(e.itemId),
    slots: e.draws
      .filter((d) => d.phase === 'bracket')
      .map((d) => ({ division: d.division, slotNo: d.slotNo })),
  }));

  return (
    <div>
      <CrewHeader title="写真撮影" description="VS画面に出す顔写真" />
      <div className="mx-auto max-w-2xl p-4">
        <PhotoList rows={rows} />
      </div>
    </div>
  );
}
