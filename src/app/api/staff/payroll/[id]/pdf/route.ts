// src/app/api/staff/payroll/[id]/pdf/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getOne, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { renderPayslipPdf, payslipFilename, type PayslipData } from '@/lib/payslip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/staff/payroll/[id]/pdf - 給与明細PDFプレビュー/ダウンロード
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const run = await getOne(
    `SELECT pr.*, i.name AS instructor_name
       FROM payroll_runs pr LEFT JOIN instructors i ON i.id = pr.instructor_id
      WHERE pr.id = ?`,
    [runId]
  );
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const lines = await getAll(
    `SELECT lesson_date, class_name, lesson_rate, transit_fee
       FROM payroll_lines WHERE payroll_run_id = ? ORDER BY lesson_date`,
    [runId]
  );
  const adjustments = await getAll(
    `SELECT adjustment_type, amount, description
       FROM payroll_adjustments WHERE payroll_run_id = ? ORDER BY created_at`,
    [runId]
  );

  const data: PayslipData = {
    run: { ...run, name: run.instructor_name } as PayslipData['run'],
    lines: lines as PayslipData['lines'],
    adjustments: adjustments as PayslipData['adjustments'],
  };

  const pdf = await renderPayslipPdf(data);
  const filename = payslipFilename(data.run);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}.pdf`,
      'Cache-Control': 'no-store',
    },
  });
}
