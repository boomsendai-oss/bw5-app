import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_TYPES = ['event_bonus', 'substitute_fee', 'special_lesson', 'deduction', 'other'];

async function recalcTotal(runId: number): Promise<void> {
  const sums = await getOne(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM payroll_adjustments WHERE payroll_run_id = ?) AS adj,
       total_lesson_amount, total_transit_amount
     FROM payroll_runs WHERE id = ?`,
    [runId, runId]
  );
  if (!sums) return;
  const adj = Number(sums.adj ?? 0);
  const total = Number(sums.total_lesson_amount ?? 0) + Number(sums.total_transit_amount ?? 0) + adj;
  await execute(
    `UPDATE payroll_runs SET total_adjustment_amount = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [adj, total, runId]
  );
}

// POST: 調整項目追加
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  const body = await req.json().catch(() => ({}));
  if (!body.adjustment_type || !VALID_TYPES.includes(body.adjustment_type)) {
    return NextResponse.json({ error: `adjustment_type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }
  if (typeof body.amount !== 'number') return NextResponse.json({ error: 'amount(number) required' }, { status: 400 });
  if (!body.description) return NextResponse.json({ error: 'description required' }, { status: 400 });
  const result = await execute(
    `INSERT INTO payroll_adjustments (payroll_run_id, adjustment_type, amount, description, created_by) VALUES (?, ?, ?, ?, ?)`,
    [runId, body.adjustment_type, body.amount, body.description, body.created_by ?? null]
  );
  await recalcTotal(runId);
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

// DELETE /api/staff/payroll/[id]/adjustments?adj_id=X
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  const url = new URL(req.url);
  const adjId = url.searchParams.get('adj_id');
  if (!adjId) return NextResponse.json({ error: 'adj_id required' }, { status: 400 });
  await execute(`DELETE FROM payroll_adjustments WHERE id = ? AND payroll_run_id = ?`, [Number(adjId), runId]);
  await recalcTotal(runId);
  return NextResponse.json({ ok: true });
}
