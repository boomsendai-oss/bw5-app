import { NextRequest, NextResponse } from "next/server";
import { getOne, execute } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/eventAuth";
import { deleteFile } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const run = await getOne(`SELECT drive_file_id FROM payroll_runs WHERE id = ?`, [runId]);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!run.drive_file_id) return NextResponse.json({ error: "アップ済みPDFがありません" }, { status: 400 });

  try {
    await deleteFile(run.drive_file_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/404|not found|File not found/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }
  await execute(
    `UPDATE payroll_runs SET drive_file_id = NULL, payslip_uploaded_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [runId]
  );
  return NextResponse.json({ ok: true });
}
