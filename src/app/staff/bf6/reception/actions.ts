'use server';

// 受付(くじ引き)専用のServer Actions。/staff/bf6/reception と /bf6/crew/reception の
// 両方から呼ばれる。どちらの経路も proxy + layout で認証済み(規約4.5)。
import { revalidatePath } from 'next/cache';
import { checkInBf6, claimBf6Slot, seedBf6Slots } from '@/lib/bf6DrawDb';
import { collectBf6Cash } from '@/lib/bf6CashDb';
import { autoReflectIfStarted } from '@/lib/bf6ScreenDb';
import type { Bf6DrawDivision, Bf6DrawPhase } from '@/lib/bf6Draw';
import { drawPhaseFor } from '@/lib/bf6Reception';

/** 同じ画面が /staff と /bf6/crew の2箇所にあるので、両方を作り直す。 */
function revalidateBoth(): void {
  revalidatePath('/staff/bf6/reception');
  revalidatePath('/bf6/crew/reception');
}


/** 受付: チェックイン + その部門の抽選を1タップで行う。 */
export async function receptionDraw(
  itemId: number,
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase
): Promise<{ slotNo: number; block?: 'A' | 'B'; alreadyDrawn: boolean } | { error: string }> {
  // ⚠️ 受付時(①)の画面でもビギナーはトーナメント位置を引く。画面のフェーズをそのまま使うと
  //    ビギナーにはブロックの枠が無く「空き枠がありません」になっていた(2026-09-11)。
  const drawPhase = drawPhaseFor(division, phase);
  await checkInBf6(itemId);
  const r = await claimBf6Slot(division, drawPhase, itemId);
  // トーナメントが始まった後に遅れて引いた人は、その人の試合がまだなら自動で対戦に戻す
  if (r && drawPhase === 'bracket') await autoReflectIfStarted(division);
  revalidateBoth();
  if (!r) return { error: '空き枠がありません' };
  return r;
}

/** 当日現金の集金を記録する(cash_due → paid)。 */
export async function receptionCollectCash(orderId: number): Promise<void> {
  // 集金画面・入場受付と同じ処理を通す(誰が受け取ったかの控えを残し、全画面に共有する)
  await collectBf6Cash(orderId, '受付スタッフ');
  revalidateBoth();
}

/** 締切後にスロットを用意する。再実行しても既存分は消さない。 */
export async function receptionSeedSlots(
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase,
  entrantCount: number
): Promise<{ created: number; total: number }> {
  const r = await seedBf6Slots(division, phase, entrantCount);
  revalidateBoth();
  return r;
}
