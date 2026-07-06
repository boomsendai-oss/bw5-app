import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { generateBankTransferCsv, toHankakuKana, type BankTransferLine } from '@/lib/bankCsv';
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

  const force = url.searchParams.get('force') === '1';
  const transferLines: BankTransferLine[] = [];
  const warnings: string[] = [];
  for (const r of rows) {
    if (!r.bank_account_number) { warnings.push(`${r.studio_name}: 口座番号未登録`); continue; }
    if (!r.bank_code || !r.bank_branch_code) warnings.push(`${r.studio_name}: 銀行/支店コード未登録`);
    const name = r.bank_account_holder || r.studio_name;
    if (!toHankakuKana(name).trim()) warnings.push(`${r.studio_name}: 受取人カナに変換できません(口座名義カナを登録してください)`);
    transferLines.push({
      recipient_name: name,
      bank_code: r.bank_code ?? '',
      branch_code: r.bank_branch_code ?? '',
      account_type: r.bank_account_type ?? '1',
      account_number: r.bank_account_number ?? '',
      amount: Math.round(r.total_amount),
    });
  }

  const validCount = transferLines.filter((l) => l.bank_code && l.account_number && l.amount > 0).length;
  const csv = generateBankTransferCsv(transferLines, { requester_name: 'ﾌﾞｰﾑ ﾀﾞﾝｽｽｸｰﾙ' });

  if (url.searchParams.get('format') === 'json') {
    return NextResponse.json({ csv, warnings, count_ok: validCount, count_total: rows.length });
  }
  // fail-closed: 未登録/変換不可があると黙って未払いになるため、強行フラグ無しでは中止(A-3)
  if (warnings.length > 0 && !force) {
    return NextResponse.json({
      error: `振込CSVに未登録/変換不可の行があります(${warnings.length}件)。修正するか ?force=1 で再取得してください`,
      warnings,
      count_ok: validCount,
      count_total: rows.length,
    }, { status: 400 });
  }

  const filename = `studio_${ym}_${validCount}件.csv`;
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
