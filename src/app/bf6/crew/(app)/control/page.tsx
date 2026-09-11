// クルー: LED操作卓。中身は /staff/bf6/control と同じ部品を使う。
//
// 機器構成: LED出力機(PC)で /bf6/screen を全画面表示し、この画面は別のiPadで開く。
// 1台でHDMIに出すとミラーリングになり操作UIまで観客に映るため、2台構成が前提。
import { ControlClient } from '@/app/staff/bf6/control/ControlClient';
import {
  getBf6ScreenState,
  listBf6ScreenMatches,
  listBf6SlotNames,
  findNextMatch,
  countBf6Undrawn,
} from '@/lib/bf6ScreenDb';
import { nextPendingMatch } from '@/lib/bf6Bracket';
import CrewHeader from '../CrewHeader';

export const dynamic = 'force-dynamic';

export default async function CrewControlPage() {
  const state = await getBf6ScreenState();
  // 直列に待つとDB往復ぶん遅い(最初のタップが重い・TARO実機 2026-09-10)
  const [{ matches, pending }, names, draw] = await Promise.all([
    listBf6ScreenMatches(state.division),
    listBf6SlotNames(state.division),
    countBf6Undrawn(state.division),
  ]);
  // 開始前は「両方がくじを引いた試合」を次の試合として出す。VSを出した時点でトーナメントが作られる
  const next = pending ? nextPendingMatch(matches) : findNextMatch(state.division, matches);

  return (
    <div>
      <CrewHeader title="LED操作卓" description="会場LEDに映す画面を切り替える" />
      <div className="mx-auto max-w-3xl p-4">
        <ControlClient
          initialState={state}
          matches={matches}
          slots={Object.fromEntries(names)}
          nextMatch={next}
          draw={draw}
          bracketPending={pending}
          allowReset={false} // 本番中の押し間違いを防ぐため、クルー画面にはリセットを出さない(TARO 2026-09-11)
        />
      </div>
    </div>
  );
}
