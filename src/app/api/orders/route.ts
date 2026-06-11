import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// 注文一覧は氏名・メアド等のPIIを含むため認証必須(T-170)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    const merchOrders = await getAll(`
      SELECT mo.id, mo.buyer_name, mo.payment_method, mo.status, mo.created_at,
             'merch' as order_type, m.name as item_name, m.price as item_price
      FROM merch_orders mo
      JOIN merchandise m ON mo.merch_id = m.id
      ORDER BY mo.created_at DESC
    `);

    const videoOrders = await getAll(`
      SELECT id, buyer_name, email, payment_method, status, created_at,
             'video' as order_type
      FROM video_orders
      ORDER BY created_at DESC
    `);

    const allOrders = [...merchOrders, ...videoOrders].sort((a: any, b: any) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return NextResponse.json(allOrders);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}
