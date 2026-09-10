// スタッフ: LEDパネルの操作卓。/staff/* 配下のためproxy認証で保護(規約4.5)。
//
// 機器構成: LED出力機で /bf6/screen を全画面表示し、この画面は別のiPadで開く。
// iPad1台でHDMIに出すとミラーリングになり操作UIまで映るため、2台構成が前提。
import StaffPageHeader from '@/components/StaffPageHeader';
import { ControlClient } from './ControlClient';
import { getBf6ScreenState, listBf6Matches, listBf6SlotNames, findNextMatch } from '@/lib/bf6ScreenDb';

export const dynamic = 'force-dynamic';

export default async function StaffBf6ControlPage() {
  const state = await getBf6ScreenState();
  // 直列に待つとDB往復ぶん遅い(最初のタップが重い・TARO実機 2026-09-10)
  const [matches, names] = await Promise.all([
    listBf6Matches(state.division),
    listBf6SlotNames(state.division),
  ]);
  const next = findNextMatch(state.division, matches);

  return (
    <div>
      <StaffPageHeader
        title="LED操作卓"
        description="会場LEDに映す画面を切り替える"
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
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
