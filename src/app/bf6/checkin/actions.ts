'use server';

// ⚠️ 公開Server Action(認証なし)。理由: 出場者が自分で操作する受付端末のため、
// 当日ログインさせるのが現実的でない(/api/bf6/photo/* と同じ扱い)。
// 扱うのは抽選と当日現金の消し込みだけで、個人情報の読み書きはしない。
import { checkInBf6, claimBf6Slot } from '@/lib/bf6DrawDb';
import { setBf6OrderStatusStaff } from '@/lib/bf6Db';
import { phaseForDivision } from '@/lib/bf6Kiosk';
import type { Bf6DrawDivision } from '@/lib/bf6Draw';

/**
 * くじを引く。二度引きは claimBf6Slot 側で弾かれ、同じ枠が返る。
 *
 * ⚠️ ここで revalidatePath を呼ばないこと。受付画面は複数手順を自分の状態で進めており、
 *    サーバ主導の再描画が入ると進行中の状態が壊れる(実機で removeChild エラーになった)。
 *    スタッフ画面は force-dynamic なので、開き直せば最新が出る。
 */
export async function kioskDraw(
  itemId: number,
  division: string
): Promise<{ slotNo: number; block?: 'A' | 'B' } | { error: string }> {
  await checkInBf6(itemId);
  const r = await claimBf6Slot(
    division as Bf6DrawDivision,
    phaseForDivision(division),
    itemId
  );
  if (!r) return { error: '空き枠がありません。スタッフにお声がけください。' };
  return r;
}

/** 当日現金を受け取ったことをスタッフが記録する。 */
export async function kioskMarkPaid(orderId: number): Promise<void> {
  await setBf6OrderStatusStaff(orderId, 'paid');
}
