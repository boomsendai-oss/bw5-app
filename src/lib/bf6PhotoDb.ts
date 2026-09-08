// 当日の顔写真の保存。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
import { getAll, execute } from '@/lib/db';

/** 撮り直しできるよう、1出場者につき1枚を上書きする。 */
export async function saveBf6Photo(itemId: number, mime: string, bytes: Uint8Array): Promise<void> {
  await execute(
    `INSERT INTO bf_photo (item_id, mime, bytes, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, created_at = excluded.created_at`,
    [itemId, mime, bytes, new Date().toISOString()]
  );
}

export async function deleteBf6Photo(itemId: number): Promise<void> {
  await execute('DELETE FROM bf_photo WHERE item_id = ?', [itemId]);
}

/** 写真を持っている出場者のitem_id。受付画面で「撮影済み」を出すのに使う。 */
export async function listBf6PhotoItemIds(): Promise<Set<number>> {
  const rows = await getAll('SELECT item_id FROM bf_photo').catch(() => []);
  return new Set(rows.map((r) => Number(r.item_id)));
}
