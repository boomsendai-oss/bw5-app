import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { oneOf, canTransition, PAYROLL_STATUSES } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/payroll/[id] - 詳細(明細+調整)
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const run = await getOne(
    `SELECT pr.*, i.name AS instructor_name, i.salary_type,
            COALESCE(i.payslip_folder_url, i.shared_folder_url) AS payslip_folder_url,
            i.contact_email,
            i.bank_name, i.bank_branch, i.bank_account_type, i.bank_account_number, i.bank_account_holder
     FROM payroll_runs pr LEFT JOIN instructors i ON i.id = pr.instructor_id
     WHERE pr.id = ?`,
    [runId]
  );
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const lines = await getAll(`SELECT * FROM payroll_lines WHERE payroll_run_id = ? ORDER BY lesson_date`, [runId]);
  const adjustments = await getAll(`SELECT * FROM payroll_adjustments WHERE payroll_run_id = ? ORDER BY created_at`, [runId]);
  return NextResponse.json({ run, lines, adjustments });
}

// PATCH /api/staff/payroll/[id] - status変更 / pdf_url登録
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  // M5: status は列挙値+許可された遷移のみ。タイポ文字列や paid→draft の
  //   不正遷移(二重支給経路)を弾く。同一statusへの再設定(pdf_url同時更新等)は許可。
  if (typeof body.status === 'string') {
    if (!oneOf(body.status, PAYROLL_STATUSES)) {
      return NextResponse.json({ error: 'status は draft/confirmed/paid のいずれか' }, { status: 400 });
    }
    const cur = await getOne(`SELECT status FROM payroll_runs WHERE id = ?`, [runId]);
    if (!cur) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (cur.status !== body.status && !canTransition(cur.status as string, body.status)) {
      return NextResponse.json({ error: `status遷移不可: ${cur.status} → ${body.status}` }, { status: 409 });
    }
    updates.push('status = ?'); args.push(body.status);
  }
  if (typeof body.pdf_url === 'string') { updates.push('pdf_url = ?'); args.push(body.pdf_url); }
  if (typeof body.notes === 'string') { updates.push('notes = ?'); args.push(body.notes); }
  if (body.status === 'paid') { updates.push('paid_at = CURRENT_TIMESTAMP'); }
  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(runId);
  await execute(`UPDATE payroll_runs SET ${updates.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
