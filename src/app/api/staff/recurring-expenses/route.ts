import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CATEGORIES = ['広告費', 'システム費', '通信費', '備品', '給与', 'スタジオ料', 'その他'];

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = await getAll(`SELECT * FROM recurring_expenses ORDER BY category, subcategory`);
  return NextResponse.json({ items: rows, categories: CATEGORIES });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.category || typeof body.amount !== 'number') {
    return NextResponse.json({ error: 'category, amount required' }, { status: 400 });
  }
  if (!CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `category must be one of ${CATEGORIES.join(', ')}` }, { status: 400 });
  }
  const result = await execute(
    `INSERT INTO recurring_expenses (category, subcategory, amount, budget_amount, description, match_pattern, active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      body.category,
      body.subcategory ?? null,
      body.amount,
      body.budget_amount ?? body.amount,
      body.description ?? null,
      body.match_pattern ?? null,
      body.active ?? 1,
    ]
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const fields = ['category', 'subcategory', 'amount', 'budget_amount', 'description', 'match_pattern', 'active'];
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); args.push(body[f]); }
  }
  if (sets.length === 0) return NextResponse.json({ ok: true, noop: true });
  args.push(Number(body.id));
  await execute(`UPDATE recurring_expenses SET ${sets.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await execute(`DELETE FROM recurring_expenses WHERE id = ?`, [Number(id)]);
  return NextResponse.json({ ok: true });
}
