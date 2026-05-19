import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { generateBankTransferCsv, type BankTransferLine } from '@/lib/bankCsv';
import { encodeShiftJIS } from '@/lib/sjis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/bank-transfer/payroll?year_month=YYYY-MM&encoding=sjis|utf8
// 給与の総合振込CSVをダウンロード
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month required (YYYY-MM)' }, { status: 400 });
  }
  const encoding = url.searchParams.get('encoding') ?? 'sjis';

  // confirmed以上のpayroll_runを対象
  const rows = (await getAll(
    `SELECT pr.id, pr.total_amount, i.name AS instructor_name, i.name_kana,
            i.bank_code, i.bank_branch_code, i.bank_account_type,
            i.bank_account_number, i.bank_account_holder, pr.status
     FROM payroll_runs pr
     LEFT JOIN instructors i ON i.id = pr.instructor_id
     WHERE pr.year_month = ? AND pr.status IN ('confirmed', 'paid')
     ORDER BY i.name`,
    [ym]
  )) as Array<{
    id: number; total_amount: number;
    instructor_name: string;
    name_kana: string | null;
    bank_code: string | null;
    bank_branch_code: string | null;
    bank_account_type: string | null;
    bank_account_number: string | null;
    bank_account_holder: string | null;
    status: string;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No confirmed payroll for this month. /staff/payroll で「確定」してください' }, { status: 400 });
  }

  // 銀行コード/支店コードはinstructorsテーブルに分離されてないので、bank_name/bank_branchから推定
  // ※ 現状は手動入力前提で、警告と共にrequester実装。bank_code/branch_codeカラム追加は別マイグレーションで対応
  const transferLines: BankTransferLine[] = [];
  const warnings: string[] = [];
  for (const r of rows) {
    const name = r.bank_account_holder || r.name_kana || r.instructor_name;
    if (!r.bank_account_number) {
      warnings.push(`${r.instructor_name}: 口座番号未登録`);
      continue;
    }
    if (!r.bank_code || !r.bank_branch_code) {
      warnings.push(`${r.instructor_name}: 銀行コード/支店コード未登録`);
    }
    transferLines.push({
      recipient_name: name,
      bank_code: r.bank_code ?? '',
      branch_code: r.bank_branch_code ?? '',
      account_type: r.bank_account_type ?? '1',
      account_number: r.bank_account_number ?? '',
      amount: Math.round(r.total_amount),
    });
  }

  const csv = generateBankTransferCsv(transferLines, {
    requester_name: 'ﾌﾞｰﾑ ﾀﾞﾝｽｽｸｰﾙ',
  });

  const filename = `payroll_${ym}_${rows.length}件.csv`;
  let body: BodyInit;
  let contentType: string;
  if (encoding === 'utf8') {
    body = '﻿' + csv;
    contentType = 'text/csv; charset=utf-8';
  } else {
    const sjisBytes = encodeShiftJIS(csv);
    body = new Uint8Array(sjisBytes);
    contentType = 'text/csv; charset=shift_jis';
  }

  if (warnings.length > 0 && url.searchParams.get('format') === 'json') {
    return NextResponse.json({ csv, warnings, count: rows.length });
  }
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'X-Warnings-Count': String(warnings.length),
    },
  });
}
