import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_TYPES = ['cancellation_fee', 'extra_rental', 'discount', 'other'];

async function recalc(runId: number): Promise<void> {
  const sums = await getOne(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM studio_billing_adjustments WHERE studio_billing_run_id = ?) AS adj,
       total_lesson_amount FROM studio_billing_runs WHERE id = ?`,
    [runId, runId]
  );
  if (!sums) return;
  const adj = Number(sums.adj ?? 0);
  const total = Number(sums.total_lesson_amount ?? 0) + adj;
  await execute(`UPDATE studio_billing_runs SET total_adjustment_amount = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [adj, total, runId]);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  const body = await req.json().catch(() => ({}));
  if (!body.adjustment_type || !VALID_TYPES.includes(body.adjustment_type)) {
    return NextResponse.json({ error: `adjustment_type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }
  if (typeof body.amount !== 'number' || !body.description) {
    return NextResponse.json({ error: 'amount(number) and description required' }, { status: 400 });
  }
  const result = await execute(
    `INSERT INTO studio_billing_adjustments (studio_billing_run_id, adjustment_type, amount, description) VALUES (?, ?, ?, ?)`,
    [runId, body.adjustment_type, body.amount, body.description]
  );
  await recalc(runId);
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  const url = new URL(req.url);
  const adjId = url.searchParams.get('adj_id');
  if (!adjId) return NextResponse.json({ error: 'adj_id required' }, { status: 400 });
  await execute(`DELETE FROM studio_billing_adjustments WHERE id = ? AND studio_billing_run_id = ?`, [Number(adjId), runId]);
  await recalc(runId);
  return NextResponse.json({ ok: true });
}
