import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 給与・スタジオ料は payroll_runs / studio_billing_runs で別管理しており、
// expenses に登録すると利益集計で二重計上になる(T-166)。経費確定では弾く。
const BLOCKED_CATEGORIES = ['給与', '人件費', 'スタジオ料', 'スタジオ使用料', 'スタジオ代'];

async function confirmOne(txnId: number, category: string, subcategory: string | null): Promise<{ ok: boolean; error?: string }> {
  const txn = await getOne(`SELECT * FROM bank_transactions WHERE id = ?`, [txnId]);
  if (!txn) return { ok: false, error: `txn ${txnId} not found` };
  const amount = Math.abs(Number(txn.amount));
  // 入金(amount > 0)は売上系として処理しないので、出金のみ経費登録
  if (Number(txn.amount) >= 0) {
    return { ok: false, error: `txn ${txnId}: 入金取引は経費登録できません` };
  }
  // 二重登録防止(既に同一source_ref_idで登録済みなら確定フラグだけ立てる)
  const dup = await getOne(`SELECT id FROM expenses WHERE source = 'bank_txn' AND source_ref_id = ?`, [txnId]);
  if (!dup) {
    await execute(
      `INSERT INTO expenses (expense_date, category, subcategory, amount, description, source, source_ref_id)
       VALUES (?, ?, ?, ?, ?, 'bank_txn', ?)`,
      [txn.txn_date, category, subcategory ?? (txn.counterparty as string | null) ?? null, amount, txn.description ?? null, txnId]
    );
  }
  await execute(`UPDATE bank_transactions SET confirmed = 1, expense_category = ? WHERE id = ?`, [category, txnId]);
  return { ok: true };
}

// POST /api/staff/expenses/confirm-bank
//   単件: { txn_id, category, subcategory? }
//   一括(T-167): { txn_ids: number[], category, subcategory? }
// 銀行明細を経費として確定登録
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const category = body.category as string | undefined;
  if (!category) {
    return NextResponse.json({ error: 'category required' }, { status: 400 });
  }
  if (BLOCKED_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `カテゴリ「${category}」は給与/スタジオ料管理と二重計上になるため経費登録できません` },
      { status: 400 }
    );
  }
  const subcategory = (body.subcategory as string | undefined) ?? null;

  // 一括確定 (T-167)
  if (Array.isArray(body.txn_ids)) {
    const ids = body.txn_ids.map(Number).filter((x: number) => Number.isFinite(x));
    if (ids.length === 0) return NextResponse.json({ error: 'txn_ids is empty' }, { status: 400 });
    let confirmed = 0;
    const errors: string[] = [];
    for (const id of ids) {
      const r = await confirmOne(id, category, subcategory);
      if (r.ok) confirmed++;
      else if (r.error) errors.push(r.error);
    }
    return NextResponse.json({ ok: true, confirmed, errors: errors.slice(0, 5) });
  }

  // 単件確定 (従来互換)
  if (!body.txn_id) {
    return NextResponse.json({ error: 'txn_id or txn_ids required' }, { status: 400 });
  }
  const r = await confirmOne(Number(body.txn_id), category, subcategory);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
