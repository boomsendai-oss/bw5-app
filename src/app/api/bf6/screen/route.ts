// ⚠️ 公開API(認証なし)。理由: 会場のLED出力機がこの状態を1秒ごとに取りに来るため。
// 当日その場に置く機器にログインさせるのは現実的でなく、返すのは
// 「いま何を映すか」と出場者のダンサーネームだけで、個人情報は含まない。
import { NextResponse } from 'next/server';
import { getBf6ScreenState, listBf6Matches, listBf6SlotNames, findNextMatch } from '@/lib/bf6ScreenDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const state = await getBf6ScreenState();
  const matches = await listBf6Matches(state.division);
  const names = await listBf6SlotNames(state.division);
  const next = findNextMatch(state.division, matches);

  return NextResponse.json(
    {
      state,
      matches,
      slots: Object.fromEntries(names),
      nextMatch: next,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
