import { execute, getAll } from '@/lib/db';

/**
 * 物販予約・取り置きの自動キャンセル
 *
 * 2段階の締切：
 *   ① 開演（事前予約締切）  = 2026-05-05 14:30 +09:00
 *      → 開演前に作られた予約は、開演時刻までに受け取りがなければ自動キャンセル
 *   ② 公演終了（取り置き締切）= 2026-05-05 18:30 +09:00
 *      → 開演後に作られた取り置きは、公演終了までに受け取りがなければ自動キャンセル
 *
 * created_at と現在時刻を見て、各 pending 予約に正しい締切を当てる。
 * Idempotent — 何度呼ばれても安全。返り値はキャンセルした件数。
 */

const PICKUP_DEADLINE_ISO = '2026-05-05T14:30:00+09:00';
const EVENT_END_ISO       = '2026-05-05T18:30:00+09:00';

export async function autoCancelExpiredOrders(): Promise<number> {
  const pickupDl = new Date(PICKUP_DEADLINE_ISO).getTime();
  const eventEnd = new Date(EVENT_END_ISO).getTime();
  const now = Date.now();

  // 開演前なら何もしない（最初の締切すら来てない）
  if (now < pickupDl) return 0;

  const pending = await getAll(
    "SELECT id, merch_id, variant_id, quantity, created_at FROM merch_orders WHERE status = 'pending'"
  );
  if (pending.length === 0) return 0;

  let cancelled = 0;
  for (const o of pending as Array<{
    id: number;
    merch_id: number;
    variant_id: number | null;
    quantity: number;
    created_at: string;
  }>) {
    try {
      const createdAt = new Date(o.created_at).getTime();
      // 事前予約（開演前作成）か 取り置き（開演後作成）かで締切が変わる
      const effectiveDeadline = createdAt < pickupDl ? pickupDl : eventEnd;
      if (now < effectiveDeadline) continue; // まだ締切前

      await execute(
        "UPDATE merch_orders SET status = 'auto_cancelled' WHERE id = ?",
        [o.id]
      );
      // 在庫戻し（バリアント→マスター）
      const qty = Number(o.quantity ?? 1);
      if (o.variant_id) {
        await execute(
          'UPDATE merch_variants SET stock = stock + ? WHERE id = ?',
          [qty, o.variant_id]
        );
      }
      await execute(
        'UPDATE merchandise SET stock = stock + ? WHERE id = ?',
        [qty, o.merch_id]
      );
      cancelled++;
    } catch (e) {
      console.error('autoCancel error', e);
    }
  }
  return cancelled;
}
