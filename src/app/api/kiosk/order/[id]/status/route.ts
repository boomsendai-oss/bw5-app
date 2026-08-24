// ⚠️ 公開API(認証なし)。理由: iPad(/kiosk)が決済完了をポーリングで検知するため。
// 返すのは注文ステータス文字列のみ(個人情報なし・注文IDは連番だが金額も明細も返さない)。
import { NextRequest, NextResponse } from 'next/server';
import { getKioskOrderStatus, sweepExpiredKioskOrders } from '@/lib/kioskDb';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await sweepExpiredKioskOrders();
  const status = await getKioskOrderStatus(orderId);
  if (!status) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ status });
}
