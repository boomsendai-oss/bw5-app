import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne, batch } from '@/lib/db';
import type { InStatement } from '@libsql/client';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { oneOf, INSTANCE_STATUSES, badRequest } from '@/lib/validate';
import { isIsoDate, isHhmm } from '@/lib/dateJst';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/staff/schedule/instances/[id]
// 既存lesson_instanceの編集 (時間/場所/インストラクター/休講)
/** パスのidを正の整数として検証。不正なら null (呼び出し側で400) */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  // M13: 無検証で status='休講' や date='2026-7-5' 等が全系統(給与/同期)を狂わせるのを防ぐ
  if (body.status !== undefined && !oneOf(body.status, INSTANCE_STATUSES)) return badRequest('status は scheduled/cancelled/removed のいずれか');
  if (body.date !== undefined && !isIsoDate(body.date)) return badRequest('date は YYYY-MM-DD 形式');
  if (body.start_time !== undefined && !isHhmm(body.start_time)) return badRequest('start_time は HH:MM 形式');
  if (body.end_time !== undefined && !isHhmm(body.end_time)) return badRequest('end_time は HH:MM 形式');
  for (const f of ['studio_id', 'instructor_id'] as const) {
    if (body[f] !== undefined && body[f] !== null && !(Number.isInteger(body[f]) && body[f] > 0)) {
      return badRequest(`${f} は正整数か null`);
    }
  }
  // date: 別日付へのリスケ(移動)用。start_time/end_time等の編集と同じく PATCH で更新できる。
  const fields = ['date', 'start_time', 'end_time', 'studio_id', 'instructor_id', 'status', 'notes'];
  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); args.push(body[f]); }
  }
  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  // 手動編集された instance は「自動実体化(確定スナップショット)」ではなくなる。
  // → 確定解除時に削除されず、決定として残る。
  updates.push('auto_materialized = 0');

  // A-4: レッスン移動(date変更)を単一batchで原子化する。旧実装は本体UPDATE後に
  //   クライアントが別リクエストで旧日付へ removed 番兵を作っており、そのPOSTが失敗すると
  //   master が旧日付に再展開→レッスン二重化→給与二重計上になっていた。
  //   さらに A-6 の UNIQUE(master_id,date) 下では移動先に古い removed 番兵が残っていると
  //   UPDATE が衝突するため、DELETE(移動先) → UPDATE → INSERT(移動元番兵) の順で実行する。
  const before = await getOne(`SELECT date, master_id, start_time, end_time FROM lesson_instances WHERE id = ?`, [numId]);
  const movingTo = before && body.date !== undefined && String(body.date) !== String(before.date) ? String(body.date) : null;
  const mid = before?.master_id as number | null | undefined;

  const stmts: InStatement[] = [];
  if (movingTo && mid != null) {
    // 移動先に残る古い removed 番兵を先に消す(UPDATEのUNIQUE衝突を回避)
    stmts.push({ sql: `DELETE FROM lesson_instances WHERE master_id = ? AND date = ? AND status = 'removed' AND id != ?`, args: [mid, movingTo, numId] });
  }
  stmts.push({ sql: `UPDATE lesson_instances SET ${updates.join(', ')} WHERE id = ?`, args: [...args, numId] });
  if (movingTo && mid != null) {
    // 移動元(旧日付)に removed 番兵を置き master の再展開を止める。start/end は NOT NULL のため供給。
    stmts.push({
      sql: `INSERT OR IGNORE INTO lesson_instances (master_id, date, start_time, end_time, status, auto_materialized) VALUES (?, ?, ?, ?, 'removed', 1)`,
      args: [mid, String(before.date), before.start_time as string, before.end_time as string],
    });
  }
  await batch(stmts, 'write');
  return NextResponse.json({ ok: true });
}

// DELETE /api/staff/schedule/instances/[id]
//
// 物理削除はしない。「その日1回分」を休講扱いにするため status='cancelled' に更新する。
// 理由: 給与計算 (payroll.ts) / スタジオ料金計算 (studioBilling.ts) は
//   - cancelled の instance を計上から除外し (status === 'cancelled' で skip)
//   - 同時に (master_id, date) を「展開済み」として記録し、lesson_master の週次再展開を抑止する
// ため、cancelled レコードが「この日は開催しない」という事実を保持する唯一の手段になっている。
// ここで物理削除すると master が翌月以降に再展開され、休講したはずのレッスンが復活して
// 給与/スタジオ料金が二重計上されてしまう。
//
// 注意: 繰り返しクラスそのもの (lesson_master) の削除/編集はカレンダーの責務ではない。
//   マスター画面 (/staff/masters) の DELETE/PATCH で行う。
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await execute(
    `UPDATE lesson_instances SET status = 'cancelled', auto_materialized = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [numId]
  );
  return NextResponse.json({ ok: true, cancelled: true });
}
