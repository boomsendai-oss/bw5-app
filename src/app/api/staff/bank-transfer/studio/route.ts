import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { generateBankTransferCsv, type BankTransferLine } from '@/lib/bankCsv';
import { encodeShiftJIS } from '@/lib/sjis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/bank-transfer/studio?year_month=YYYY-MM
// スタジオ料金の銀行振込CSV (postpaid_bank / prepaid_bank のみ)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month required' }, { status: 400 });
  }
  const encoding = url.searchParams.get('encoding') ?? 'sjis';

  const rows = (await getAll(
    `SELECT sbr.id, sbr.total_amount, s.name AS studio_name, s.payment_type,
            s.bank_code, s.bank_branch_code, s.bank_account_type,
            s.bank_account_number, s.bank_account_holder, sbr.status
     FROM studio_billing_runs sbr
     LEFT JOIN studios s ON s.id = sbr.studio_id
     WHERE sbr.year_month = ? AND sbr.status IN ('confirmed', 'paid')
       AND s.payment_type IN ('prepaid_bank', 'postpaid_bank')
     ORDER BY s.name`,
    [ym]
  )) as Array<{
    id: number; total_amount: number; studio_name: string; payment_type: string;
    bank_code: string | null; bank_branch_code: string | null;
    bank_account_type: string | null; bank_account_number: string | null;
    bank_account_holder: string | null; status: string;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No confirmed studio billing for bank transfer' }, { status: 400 });
  }

  const transferLines: BankTransferLine[] = [];
  const warnings: string[] = [];
  for (const r of rows) {
    if (!r.bank_account_number) { warnings.push(`${r.studio_name}: 口座番号未登録`); continue; }
    if (!r.bank_code || !r.bank_branch_code) warnings.push(`${r.studio_name}: 銀行/支店コード未登録`);
    transferLines.push({
      recipient_name: r.bank_account_holder || r.studio_name,
      bank_code: r.bank_code ?? '',
      branch_code: r.bank_branch_code ?? '',
      account_type: r.bank_account_type ?? '1',
      account_number: r.bank_account_number ?? '',
      amount: Math.round(r.total_amount),
    });
  }

  const csv = generateBankTransferCsv(transferLines, { requester_name: 'ﾌﾞｰﾑ ﾀﾞﾝｽｽｸｰﾙ' });
  const filename = `studio_${ym}_${rows.length}件.csv`;
  let body: BodyInit;
  let contentType: string;
  if (encoding === 'utf8') {
    body = '﻿' + csv;
    contentType = 'text/csv; charset=utf-8';
  } else {
    body = new Uint8Array(encodeShiftJIS(csv));
    contentType = 'text/csv; charset=shift_jis';
  }
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'X-Warnings-Count': String(warnings.length),
    },
  });
}
