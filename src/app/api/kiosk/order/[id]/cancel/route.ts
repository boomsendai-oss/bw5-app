// ⚠️ 公開API(認証なし)。理由: iPad(/kiosk)がQR画面の「やめる」/放置タイムアウトで
// 仮押さえを解放するため。pendingの注文をexpired化するだけで、支払い済み注文には作用しない。
import { NextRequest, NextResponse } from 'next/server';
import { cancelKioskOrder, getKioskOrderSessionId } from '@/lib/kioskDb';
import { expireKioskCheckoutSession } from '@/lib/kioskStripe';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const cancelled = await cancelKioskOrder(orderId);
  if (cancelled) {
    // 遅れて支払われるのを防ぐためStripe側も失効させる(失敗しても致命ではない)
    const sessionId = await getKioskOrderSessionId(orderId);
    if (sessionId) await expireKioskCheckoutSession(sessionId);
  }
  return NextResponse.json({ cancelled });
}
