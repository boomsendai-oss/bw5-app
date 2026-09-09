// クルー: LED操作卓。中身は /staff/bf6/control と同じ部品を使う。
//
// 機器構成: LED出力機(PC)で /bf6/screen を全画面表示し、この画面は別のiPadで開く。
// 1台でHDMIに出すとミラーリングになり操作UIまで観客に映るため、2台構成が前提。
import { ControlClient } from '@/app/staff/bf6/control/ControlClient';
import {
  getBf6ScreenState,
  listBf6Matches,
  listBf6SlotNames,
  findNextMatch,
} from '@/lib/bf6ScreenDb';
import CrewHeader from '../CrewHeader';

export const dynamic = 'force-dynamic';

export default async function CrewControlPage() {
  const state = await getBf6ScreenState();
  const matches = await listBf6Matches(state.division);
  const names = await listBf6SlotNames(state.division);
  const next = findNextMatch(state.division, matches);

  return (
    <div>
      <CrewHeader title="LED操作卓" description="会場LEDに映す画面を切り替える" />
      <div className="mx-auto max-w-3xl p-4">
        <ControlClient
          initialState={state}
          matches={matches}
          slots={Object.fromEntries(names)}
          nextMatch={next}
        />
      </div>
    </div>
  );
}
