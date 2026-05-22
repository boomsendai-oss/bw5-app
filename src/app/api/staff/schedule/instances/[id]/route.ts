import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

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
  const fields = ['start_time', 'end_time', 'studio_id', 'instructor_id', 'status', 'notes'];
  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); args.push(body[f]); }
  }
  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(numId);
  await execute(`UPDATE lesson_instances SET ${updates.join(', ')} WHERE id = ?`, args);
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
    `UPDATE lesson_instances SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [numId]
  );
  return NextResponse.json({ ok: true, cancelled: true });
}
