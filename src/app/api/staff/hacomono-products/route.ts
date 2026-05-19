import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const where = type ? 'WHERE product_type = ?' : '';
  const args = type ? [type] : [];
  const rows = await getAll(`SELECT * FROM hacomono_products ${where} ORDER BY product_type, price DESC, name`, args);
  return NextResponse.json({ products: rows });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const fields = ['name', 'price', 'category', 'active', 'notes'];
  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); args.push(body[f]); }
  }
  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(Number(body.id));
  await execute(`UPDATE hacomono_products SET ${updates.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
