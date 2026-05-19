import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  const run = await getOne(
    `SELECT sbr.*, s.name AS studio_name, s.pricing_model, s.hourly_rate, s.payment_type, s.daily_buffer_minutes
     FROM studio_billing_runs sbr LEFT JOIN studios s ON s.id = sbr.studio_id WHERE sbr.id = ?`,
    [runId]
  );
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const lines = await getAll(`SELECT * FROM studio_billing_lines WHERE studio_billing_run_id = ? ORDER BY lesson_date`, [runId]);
  const adjustments = await getAll(`SELECT * FROM studio_billing_adjustments WHERE studio_billing_run_id = ? ORDER BY created_at`, [runId]);
  return NextResponse.json({ run, lines, adjustments });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  if (typeof body.status === 'string') { updates.push('status = ?'); args.push(body.status); }
  if (typeof body.notes === 'string') { updates.push('notes = ?'); args.push(body.notes); }
  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(Number(id));
  await execute(`UPDATE studio_billing_runs SET ${updates.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
