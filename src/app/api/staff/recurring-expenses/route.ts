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
    `INSERT INTO recurring_expenses (category, subcategory, amount, description, active) VALUES (?, ?, ?, ?, ?)`,
    [body.category, body.subcategory ?? null, body.amount, body.description ?? null, body.active ?? 1]
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await execute(`DELETE FROM recurring_expenses WHERE id = ?`, [Number(id)]);
  return NextResponse.json({ ok: true });
}
