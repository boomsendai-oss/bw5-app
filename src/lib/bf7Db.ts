// BF7 ウェイトリストの保存。DBアクセスは db.ts 経由(規約3)。
import { getAll, getOne, execute } from './db';
import { nowUtcIso } from './dateJst';
import type { Bf7NotifyValid } from './bf7';

export type Bf7NotifyRow = {
  id: number; name: string; email: string; divisions: string[]; note: string; createdAt: string;
};

/** 登録する。同じメールは上書き(2回押しても増えない)。戻り値は通し番号。 */
export async function addBf7Notify(v: Bf7NotifyValid): Promise<{ id: number; already: boolean }> {
  const now = nowUtcIso();
  const existing = await getOne('SELECT id FROM bf7_notify WHERE email = ?', [v.email]).catch(() => null);
  if (existing) {
    await execute('UPDATE bf7_notify SET name = ?, divisions = ?, note = ? WHERE id = ?', [
      v.name, JSON.stringify(v.divisions), v.note, Number(existing.id),
    ]);
    return { id: Number(existing.id), already: true };
  }
  const r = await execute(
    'INSERT INTO bf7_notify (name, email, divisions, note, created_at) VALUES (?, ?, ?, ?, ?)',
    [v.name, v.email, JSON.stringify(v.divisions), v.note, now]
  );
  return { id: Number(r.lastInsertRowid ?? 0), already: false };
}

export async function countBf7Notify(): Promise<{ total: number; byDivision: Record<string, number> }> {
  const rows = await getAll('SELECT divisions FROM bf7_notify').catch(() => []);
  const byDivision: Record<string, number> = { beginner: 0, kids: 0, general: 0 };
  for (const r of rows) {
    let list: string[] = [];
    try { list = JSON.parse(String(r.divisions ?? '[]')); } catch { list = []; }
    for (const d of list) if (d in byDivision) byDivision[d] += 1;
  }
  return { total: rows.length, byDivision };
}

export async function listBf7Notify(): Promise<Bf7NotifyRow[]> {
  const rows = await getAll('SELECT id, name, email, divisions, note, created_at FROM bf7_notify ORDER BY id DESC').catch(() => []);
  return rows.map((r) => {
    let divisions: string[] = [];
    try { divisions = JSON.parse(String(r.divisions ?? '[]')); } catch { divisions = []; }
    return {
      id: Number(r.id), name: String(r.name ?? ''), email: String(r.email ?? ''),
      divisions, note: String(r.note ?? ''), createdAt: String(r.created_at ?? ''),
    };
  });
}
