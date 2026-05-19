import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/hacomono-products/bulk-import
// body: { products: [{ product_type, name, price, category?, notes? }] }
//
// UPSERT で一括登録 (product_type+name でユニーク)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.products)) return NextResponse.json({ error: 'products array required' }, { status: 400 });
  let inserted = 0;
  for (const p of body.products) {
    if (!p.product_type || !p.name || typeof p.price !== 'number') continue;
    await execute(
      `INSERT INTO hacomono_products (product_type, name, price, category, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(product_type, name) DO UPDATE SET
         price = excluded.price,
         category = COALESCE(excluded.category, hacomono_products.category),
         notes = COALESCE(excluded.notes, hacomono_products.notes),
         updated_at = CURRENT_TIMESTAMP`,
      [p.product_type, p.name, p.price, p.category ?? null, p.notes ?? null]
    );
    inserted++;
  }
  return NextResponse.json({ ok: true, inserted });
}
