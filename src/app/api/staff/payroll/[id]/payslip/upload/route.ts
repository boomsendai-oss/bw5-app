import { NextRequest, NextResponse } from "next/server";
import { getOne, getAll, execute } from "@/lib/db";
import { isAuthorized, unauthorized } from "@/lib/eventAuth";
import { renderPayslipPdf, payslipFilename, type PayslipData } from "@/lib/payslip";
import { uploadPdfToFolder, updatePdf } from "@/lib/drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function folderIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/folders\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const run = await getOne(
    `SELECT pr.*, i.name AS instructor_name, i.payslip_folder_url, i.shared_folder_url
       FROM payroll_runs pr LEFT JOIN instructors i ON i.id = pr.instructor_id
      WHERE pr.id = ?`,
    [runId]
  );
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const folderId = folderIdFromUrl(run.payslip_folder_url) ?? folderIdFromUrl(run.shared_folder_url);
  if (!folderId) return NextResponse.json({ error: "フォルダURL未設定" }, { status: 400 });

  const lines = await getAll(
    `SELECT lesson_date, class_name, lesson_rate, transit_fee FROM payroll_lines WHERE payroll_run_id = ? ORDER BY lesson_date`,
    [runId]
  );
  const adjustments = await getAll(
    `SELECT adjustment_type, amount, description FROM payroll_adjustments WHERE payroll_run_id = ? ORDER BY created_at`,
    [runId]
  );
  const data: PayslipData = {
    run: { ...run, name: run.instructor_name } as PayslipData["run"],
    lines: lines as PayslipData["lines"],
    adjustments: adjustments as PayslipData["adjustments"],
  };

  const pdf = await renderPayslipPdf(data);
  const filename = payslipFilename(data.run) + ".pdf";

  try {
    let fileId: string | null = run.drive_file_id ?? null;
    let webViewLink: string | null = null;
    if (fileId) {
      await updatePdf(fileId, pdf);
    } else {
      const r = await uploadPdfToFolder(folderId, filename, pdf);
      fileId = r.fileId;
      webViewLink = r.webViewLink;
    }
    await execute(
      `UPDATE payroll_runs SET drive_file_id = ?, payslip_uploaded_at = CURRENT_TIMESTAMP, pdf_url = COALESCE(?, pdf_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [fileId, webViewLink, runId]
    );
    return NextResponse.json({ ok: true, fileId, webViewLink });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
