'use server';

// ⚠️ 公開Server Action(認証なし)。理由: 出場者が自分で操作する受付端末のため、
// 当日ログインさせるのが現実的でない(/api/bf6/photo/* と同じ扱い)。
// 扱うのは抽選と「支払い済みかどうかの確認」だけで、個人情報の読み書きはしない。
import { checkInBf6, claimBf6Slot, listBf6Slots } from '@/lib/bf6DrawDb';
import { collectBf6Cash, isBf6OrderPaid } from '@/lib/bf6CashDb';
import { autoReflectIfStarted } from '@/lib/bf6ScreenDb';
import { listBf6Qualifiers } from '@/lib/bf6QualifierDb';
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
      /** 引いたくじの種類。'bracket' ならトーナメントの位置 */
      phase: 'block' | 'bracket';
      /** すでに引いていた人を押したとき。引き直しはしていない */
      alreadyDrawn: boolean;
      /** トーナメント表を描くための 枠→名前。引いていない枠は入らない */
      holders?: Record<number, string>;
      slotCount?: number;
    }
  | { error: string }
> {
  // ⚠️ くじの種類は画面から受け取らずサーバで決める。
  //    予選通過者に登録されていれば、その部門の次は「ベスト8の位置」(くじ引き②・TARO 2026-09-14)。
  const qualifiers = await listBf6Qualifiers().catch(() => ({}) as Record<string, Set<number>>);
  const phase: 'block' | 'bracket' =
    division === 'beginner' || qualifiers[division]?.has(itemId) ? 'bracket' : 'block';

  const r = await claimBf6Slot(division as Bf6DrawDivision, phase, itemId);
  if (!r) return { error: '空き枠がありません。スタッフにお声がけください。' };
  // くじに成功したときだけチェックインを付ける(失敗しても受付済みに見えていた・2026-09-11)
  await checkInBf6(itemId);
  if (phase !== 'bracket') return { ...r, phase };
  // トーナメントが始まった後に遅れて引いた人は、その人の試合がまだなら自動で対戦に戻す
  await autoReflectIfStarted(division as Bf6DrawDivision);
  // 番号だけ出しても出場者には分からないので、トーナメント表ごと返す
  const slots = await listBf6Slots(division as Bf6DrawDivision, phase);
  const holders: Record<number, string> = {};
  for (const s of slots) if (s.dancerName) holders[s.slotNo] = s.dancerName;
  return { ...r, phase, holders, slotCount: slots.length };
}

/**
 * 集金係がこの申込の現金を受け取ったか。支払い済みかどうか以外は返さない。
 * 集金係がスマホで記録すると、この確認で受付iPadが自動で次に進む。
 */
export async function kioskIsPaid(orderId: number): Promise<boolean> {
  if (!Number.isInteger(orderId) || orderId <= 0) return false;
  return isBf6OrderPaid(orderId);
}

/**
 * 出場者が受付iPadで「支払いました」を押したときの記録。
 *
 * ⚠️ ここは認証がない画面なので、押した本人の申告をそのまま信じることになる。
 *    それでもこの導線を置くのは、集金係が記録するまでiPadの前で待たせると受付が詰まるため(TARO 2026-09-14)。
 *    お金の突合ができるよう、誰の記録かが分かる名前で残す(集金画面に「受付iPad(本人申告)」と出る)。
 */
export async function kioskMarkPaid(orderId: number): Promise<{ ok: boolean }> {
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false };
  const r = await collectBf6Cash(orderId, '受付iPad(本人申告)');
  return { ok: r.ok };
}
