'use server';

// LED演出の操作。/staff/* 配下のためproxy認証で保護(規約4.5)。
import { revalidatePath } from 'next/cache';
import { setBf6ScreenState, setBf6Winner, seedBf6Bracket, type ScreenMode } from '@/lib/bf6ScreenDb';
import type { Bf6DrawDivision } from '@/lib/bf6Draw';
import type { Round } from '@/lib/bf6Bracket';

export async function controlSetMode(mode: ScreenMode, division?: Bf6DrawDivision): Promise<void> {
  await setBf6ScreenState(division ? { mode, division } : { mode });
  revalidatePath('/staff/bf6/control');
}

/** VS画面を出す。試合を指定しなければ「次の試合」が映る。 */
export async function controlShowVs(round: Round | null, matchNo: number | null): Promise<void> {
  await setBf6ScreenState({ mode: 'vs', round, matchNo });
  revalidatePath('/staff/bf6/control');
}

export async function controlSetWinner(
  division: Bf6DrawDivision,
  round: Round,
  matchNo: number,
  winnerSlot: number
): Promise<void> {
  await setBf6Winner(division, round, matchNo, winnerSlot);
  // 勝者確定後はトーナメント表に戻す。次のVSへは操作する人がワンタップで進める
  // (MCの間合いに合わせるため自動遷移にしない・TARO 2026-08-21)
  await setBf6ScreenState({ mode: 'bracket', round: null, matchNo: null });
  revalidatePath('/staff/bf6/control');
}

export async function controlSeedBracket(division: Bf6DrawDivision): Promise<{ created: number }> {
  const r = await seedBf6Bracket(division);
  revalidatePath('/staff/bf6/control');
  return r;
}
