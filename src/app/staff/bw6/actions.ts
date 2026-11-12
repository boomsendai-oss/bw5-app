'use server';

// BW6 発表会のスタッフの最初の画面の Server Actions。/staff/* は proxy（cookie の有無）で覆われているが、
// proxy は DB を見られないので requireRecitalStaff() でセッションを必ず本検証する（規約4.5）。
import { revalidatePath } from 'next/cache';
import { pickStaffEventKey } from '@/lib/recital';
import { dismissAttention } from '@/lib/recitalDb';
import { requireRecitalStaff } from '@/lib/recitalGuard';

/** 見てほしいことの1番・3番の「問題なし」 */
export async function dismissAttentionAction(
  ev: string,
  item: { no: 1 | 3; householdId?: number; personId?: number },
  staffName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireRecitalStaff();
  try {
    await dismissAttention(pickStaffEventKey(ev), item, staffName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    return { ok: false, error: msg.includes('staff_name') ? '名前を選んでください' : '記録できませんでした' };
  }
  revalidatePath('/staff/bw6');
  return { ok: true };
}
