'use server';

// ⚠️ 公開Server Action(認証なし)。理由: 出場者が自分で操作する受付端末のため、
// 当日ログインさせるのが現実的でない(/api/bf6/photo/* と同じ扱い)。
// 扱うのは抽選と「支払い済みかどうかの確認」だけで、個人情報の読み書きはしない。
import { checkInBf6, claimBf6Slot, listBf6Slots } from '@/lib/bf6DrawDb';
import { isBf6OrderPaid } from '@/lib/bf6CashDb';
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
): Promise<
  | {
      slotNo: number;
      block?: 'A' | 'B';
      /** トーナメント表を描くための 枠→名前。引いていない枠は入らない */
      holders?: Record<number, string>;
      slotCount?: number;
    }
  | { error: string }
> {
  await checkInBf6(itemId);
  const r = await claimBf6Slot(
    division as Bf6DrawDivision,
    phaseForDivision(division),
    itemId
  );
  if (!r) return { error: '空き枠がありません。スタッフにお声がけください。' };

  // 番号だけ出しても出場者には分からないので、トーナメント表ごと返す
  const phase = phaseForDivision(division);
  if (phase !== 'bracket') return r;
  const slots = await listBf6Slots(division as Bf6DrawDivision, phase);
  const holders: Record<number, string> = {};
  for (const s of slots) if (s.dancerName) holders[s.slotNo] = s.dancerName;
  return { ...r, holders, slotCount: slots.length };
}

/**
 * 集金係がこの申込の現金を受け取ったか。支払い済みかどうか以外は返さない。
 *
 * ⚠️ 以前はここに「支払い済みにする」公開アクションがあり、出場者本人が払わずに
 *    「支払いを終了しました」を押すだけで通っていた(認証なし・2026-09-11に廃止)。
 *    受け取りの記録は集金係のスマホ(/bf6/crew/cash)でだけ行う。
 */
export async function kioskIsPaid(orderId: number): Promise<boolean> {
  if (!Number.isInteger(orderId) || orderId <= 0) return false;
  return isBf6OrderPaid(orderId);
}
