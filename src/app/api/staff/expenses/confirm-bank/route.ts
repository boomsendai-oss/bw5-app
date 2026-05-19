import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/expenses/confirm-bank
// { txn_id, category, subcategory? }
// 銀行明細を経費として確定登録
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.txn_id || !body.category) {
    return NextResponse.json({ error: 'txn_id and category required' }, { status: 400 });
  }
  const txn = await getOne(`SELECT * FROM bank_transactions WHERE id = ?`, [Number(body.txn_id)]);
  if (!txn) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });

  const amount = Math.abs(Number(txn.amount));
  // 入金(amount > 0)は売上系として処理しないので、出金のみ経費登録
  if (Number(txn.amount) >= 0) {
    return NextResponse.json({ error: '入金取引は経費登録できません' }, { status: 400 });
  }

  await execute(
    `INSERT INTO expenses (expense_date, category, subcategory, amount, description, source, source_ref_id)
     VALUES (?, ?, ?, ?, ?, 'bank_txn', ?)`,
    [
      txn.txn_date,
      body.category,
      body.subcategory ?? txn.counterparty ?? null,
      amount,
      txn.description ?? null,
      txn.id,
    ]
  );
  await execute(`UPDATE bank_transactions SET confirmed = 1, expense_category = ? WHERE id = ?`, [body.category, Number(body.txn_id)]);
  return NextResponse.json({ ok: true });
}
