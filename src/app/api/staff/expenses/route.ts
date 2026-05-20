import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATEGORIES = ['広告費', 'システム費', '通信費', '備品', '給与', 'スタジオ料', 'その他'];

// GET /api/staff/expenses?year_month=YYYY-MM
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  let where = '';
  const args: string[] = [];
  if (ym) {
    where = 'WHERE expense_date BETWEEN ? AND ?';
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    args.push(`${ym}-01`, `${ym}-${String(lastDay).padStart(2, '0')}`);
  }
  const expenses = await getAll(
    `SELECT * FROM expenses ${where} ORDER BY expense_date DESC, id DESC`,
    args
  );
  const summary = await getAll(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM expenses ${where} GROUP BY category`,
    args
  );
  // 未確定の銀行明細 (LIMIT 500 - 月内ぜんぶ見えるよう拡大)
  const pendingBankTxns = await getAll(
    `SELECT * FROM bank_transactions WHERE confirmed = 0 ${ym ? `AND txn_date BETWEEN ? AND ?` : ''} ORDER BY txn_date DESC LIMIT 500`,
    ym ? args : []
  );
  return NextResponse.json({ expenses, summary, pendingBankTxns, categories: CATEGORIES });
}

// POST /api/staff/expenses - 手動登録
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.expense_date || !body.category || typeof body.amount !== 'number') {
    return NextResponse.json({ error: 'expense_date, category, amount required' }, { status: 400 });
  }
  if (!CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `category must be one of ${CATEGORIES.join(', ')}` }, { status: 400 });
  }
  const result = await execute(
    `INSERT INTO expenses (expense_date, category, subcategory, amount, description, source, source_ref_id, is_recurring)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.expense_date,
      body.category,
      body.subcategory ?? null,
      body.amount,
      body.description ?? null,
      body.source ?? 'manual',
      body.source_ref_id ?? null,
      body.is_recurring ? 1 : 0,
    ]
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

// DELETE /api/staff/expenses?id=X
export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await execute(`DELETE FROM expenses WHERE id = ?`, [Number(id)]);
  return NextResponse.json({ ok: true });
}
