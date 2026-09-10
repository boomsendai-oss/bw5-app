// 顔写真の元画像(切り抜き前)と、Macの切り抜き係の受け渡し。src/lib/db.ts 経由のみ。
//
// 流れ: スマホ→(仮の切り抜き+元画像)→ここ。Mac常駐の切り抜き係が queue を見て
// 元画像を取り、rembgで抜き直し、/api/bf6/photo/upload へ返す(cut_at が埋まる)。
import { getAll, getOne, execute } from '@/lib/db';

/** 元画像を保存。撮り直しなら上書きし、cut_at を消して「抜き直し待ち」に戻す。 */
export async function saveBf6PhotoRaw(itemId: number, mime: string, bytes: Uint8Array): Promise<void> {
  await execute(
    `INSERT INTO bf_photo_raw (item_id, mime, bytes, created_at, cut_at, cut_model)
     VALUES (?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(item_id) DO UPDATE SET
       mime = excluded.mime, bytes = excluded.bytes, created_at = excluded.created_at,
       cut_at = NULL, cut_model = NULL`,
    [itemId, mime, bytes, new Date().toISOString()]
  );
}

/** 抜き直し待ちの item_id(古い順)。 */
export async function listBf6CutoutQueue(): Promise<{ itemId: number; createdAt: string }[]> {
  const rows = await getAll(
    'SELECT item_id, created_at FROM bf_photo_raw WHERE cut_at IS NULL ORDER BY created_at'
  ).catch(() => []);
  return rows.map((r) => ({ itemId: Number(r.item_id), createdAt: String(r.created_at) }));
}

export async function getBf6PhotoRaw(itemId: number): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const r = await getOne('SELECT mime, bytes FROM bf_photo_raw WHERE item_id = ?', [itemId]).catch(() => null);
  if (!r) return null;
  return { mime: String(r.mime), bytes: r.bytes as Uint8Array };
}

export async function markBf6PhotoCut(itemId: number, model: string): Promise<void> {
  await execute('UPDATE bf_photo_raw SET cut_at = ?, cut_model = ? WHERE item_id = ?', [
    new Date().toISOString(),
    model,
    itemId,
  ]);
}

/** 切り抜き係の合言葉(bf_settings)。未設定なら空=誰も通さない。 */
export async function getBf6CutoutWorkerKey(): Promise<string> {
  const r = await getOne("SELECT value FROM bf_settings WHERE key = 'cutout_worker_key'").catch(() => null);
  return r?.value ? String(r.value) : '';
}
