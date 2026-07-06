import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { generateBankTransferCsv, toHankakuKana, type BankTransferLine } from '@/lib/bankCsv';
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
  const force = url.searchParams.get('force') === '1';
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
    // 漢字名義などが半角カナ変換で全スペース化すると銀行に無名口座で出てしまう
    if (!toHankakuKana(name).trim()) {
      warnings.push(`${r.instructor_name}: 受取人カナに変換できません(口座名義カナを登録してください)`);
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

  // 実際にCSVへ出力される有効行数(bankCsv側でskipされない行)
  const validCount = transferLines.filter((l) => l.bank_code && l.account_number && l.amount > 0).length;
  const csv = generateBankTransferCsv(transferLines, {
    requester_name: 'ﾌﾞｰﾑ ﾀﾞﾝｽｽｸｰﾙ',
  });

  // format=json は情報提供用(警告と有効件数を返す)
  if (url.searchParams.get('format') === 'json') {
    return NextResponse.json({ csv, warnings, count_ok: validCount, count_total: rows.length });
  }
  // fail-closed: 未登録/変換不可があると1名でも黙って未払いになるため、強行フラグ無しでは中止(A-3)
  if (warnings.length > 0 && !force) {
    return NextResponse.json({
      error: `振込CSVに未登録/変換不可の行があります(${warnings.length}件)。修正するか、内容を確認のうえ ?force=1 を付けて再取得してください`,
      warnings,
      count_ok: validCount,
      count_total: rows.length,
    }, { status: 400 });
  }

  const filename = `payroll_${ym}_${validCount}件.csv`;
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

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'X-Warnings-Count': String(warnings.length),
    },
  });
}
