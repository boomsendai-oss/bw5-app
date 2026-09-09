// 予選通過者の永続化。計算は bf6Qualifier.ts。
import { getAll, execute } from './db';
import { nowUtcIso } from './dateJst';

/** 部門ごとの通過者(item_id の集合)。テーブルが無くても落とさない。 */
export async function listBf6Qualifiers(): Promise<Record<string, Set<number>>> {
  const rows = await getAll('SELECT division, item_id FROM bf_qualifier').catch(() => []);
  const out: Record<string, Set<number>> = {};
  for (const r of rows) {
    const d = String(r.division);
    (out[d] ??= new Set()).add(Number(r.item_id));
  }
  return out;
}

/** 通過者の出し入れ。二度押しでも同じ状態になる。 */
export async function setBf6Qualifier(division: string, itemId: number, on: boolean): Promise<void> {
  if (on) {
    await execute(
      'INSERT INTO bf_qualifier (division, item_id, created_at) VALUES (?, ?, ?) ON CONFLICT(division, item_id) DO NOTHING',
      [division, itemId, nowUtcIso()]
    );
  } else {
    await execute('DELETE FROM bf_qualifier WHERE division = ? AND item_id = ?', [division, itemId]);
  }
}
