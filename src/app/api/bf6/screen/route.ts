// ⚠️ 公開API(認証なし)。理由: 会場のLED出力機がこの状態を1秒ごとに取りに来るため。
// 当日その場に置く機器にログインさせるのは現実的でなく、返すのは
// 「いま何を映すか」と出場者のダンサーネームだけで、個人情報は含まない。
import { NextResponse } from 'next/server';
import { hideFinalWinner, needsChampions } from '@/lib/bf6ScreenAnim';
import { getBf6ScreenState, listBf6ScreenMatches, listBf6SlotNames, listBf6Champions, findNextMatch } from '@/lib/bf6ScreenDb';
import { getBf6ScreenStreamSrc } from '@/lib/bf6StreamDb';

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
  // 優勝者は発表(とその前のドラムロール)のときだけ取りに行く。毎秒のポーリングを重くしないため
  const champions = needsChampions(state.mode) ? await listBf6Champions() : null;
  // ⚠️ 配信の再生URLは「配信モード」のあいだだけ返す。常に返すと、この公開APIを叩けば
  //    誰でも配信チケット無しで見られてしまう(bf6StreamDb の注意書きも参照)
  const streamSrc = state.mode === 'stream' ? await getBf6ScreenStreamSrc() : null;

  return NextResponse.json(
    {
      state,
      // ⚠️ 決勝の勝者はLEDに渡さない(優勝枠に出るとネタバレ)。次の試合の判定は上で本物の値を使う
      matches: hideFinalWinner(matches),
      pending,
      slots: Object.fromEntries(names),
      nextMatch: next,
      champions,
      streamSrc,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
