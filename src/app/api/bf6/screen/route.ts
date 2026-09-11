// ⚠️ 公開API(認証なし)。理由: 会場のLED出力機がこの状態を1秒ごとに取りに来るため。
// 当日その場に置く機器にログインさせるのは現実的でなく、返すのは
// 「いま何を映すか」と出場者のダンサーネームだけで、個人情報は含まない。
import { NextResponse } from 'next/server';
import { getBf6ScreenState, listBf6ScreenMatches, listBf6SlotNames, findNextMatch } from '@/lib/bf6ScreenDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const state = await getBf6ScreenState();
  // くじ引きの結果は自動で反映する。開始前は pending=true(不戦勝の勝ち上がりを出さない)
  const [{ matches, pending }, names] = await Promise.all([
    listBf6ScreenMatches(state.division),
    listBf6SlotNames(state.division),
  ]);
  // 開始前はVSを出さない(最初のVSを出す操作で試合が作られてから映す)
  const next = pending ? null : findNextMatch(state.division, matches);

  return NextResponse.json(
    {
      state,
      matches,
      pending,
      slots: Object.fromEntries(names),
      nextMatch: next,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
