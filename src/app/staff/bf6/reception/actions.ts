'use server';

// 受付(くじ引き)専用のServer Actions。/staff/* 配下のためproxy認証で保護(規約4.5)。
import { revalidatePath } from 'next/cache';
import { checkInBf6, claimBf6Slot, seedBf6Slots } from '@/lib/bf6DrawDb';
import { setBf6OrderStatusStaff } from '@/lib/bf6Db';
import type { Bf6DrawDivision, Bf6DrawPhase } from '@/lib/bf6Draw';

/** 受付: チェックイン + その部門の抽選を1タップで行う。 */
export async function receptionDraw(
  itemId: number,
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase
): Promise<{ slotNo: number; block?: 'A' | 'B'; alreadyDrawn: boolean } | { error: string }> {
  await checkInBf6(itemId);
  const r = await claimBf6Slot(division, phase, itemId);
  revalidatePath('/staff/bf6/reception');
  if (!r) return { error: '空き枠がありません' };
  return r;
}

/** 当日現金の集金を記録する(cash_due → paid)。 */
export async function receptionCollectCash(orderId: number): Promise<void> {
  await setBf6OrderStatusStaff(orderId, 'paid');
  revalidatePath('/staff/bf6/reception');
}

/** 締切後にスロットを用意する。再実行しても既存分は消さない。 */
export async function receptionSeedSlots(
  division: Bf6DrawDivision,
  phase: Bf6DrawPhase,
  entrantCount: number
): Promise<{ created: number; total: number }> {
  const r = await seedBf6Slots(division, phase, entrantCount);
  revalidatePath('/staff/bf6/reception');
  return r;
}
