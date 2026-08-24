// ⚠️ 公開API(認証なし)。理由: Stripe Webhook受信用エンドポイント(Stripeのサーバが叩く)。
// 認可は Stripe-Signature ヘッダの署名検証(STRIPE_KIOSK_WEBHOOK_SECRET)で行い、
// 署名のない/不正な要求は400で弾く。kioskの決済確定はこのWebhookが正本(設計書)。
// 同一Stripeアカウントの他系統(BF6)のイベントも届くが、metadata.kiosk_order_id が
// 無いものは order_not_found として受領だけする(200)。
import { NextRequest, NextResponse } from 'next/server';
import { parseKioskWebhookEvent, verifyStripeSignature } from '@/lib/kioskStripe';
import { applyKioskWebhookEvent } from '@/lib/kioskDb';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_KIOSK_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[kiosk] STRIPE_KIOSK_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'not configured' }, { status: 500 });
  }

  const payload = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!verifyStripeSignature(payload, sig, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }
  const ev = parseKioskWebhookEvent(event);
  if (!ev) return NextResponse.json({ error: 'invalid event' }, { status: 400 });

  // kiosk宛でない(BF6等の)イベントは記録もせず受領だけ返す
  if (ev.orderId == null) return NextResponse.json({ received: true, result: 'not_kiosk' });

  try {
    const result = await applyKioskWebhookEvent(ev, payload);
    if (result.status === 'paid' && result.amountMismatch) {
      console.error('[kiosk] amount mismatch on order', result.orderId, 'stripe:', ev.amountTotal);
    }
    return NextResponse.json({ received: true, result: result.status });
  } catch (e) {
    // 500を返すとStripeが自動リトライする(kiosk_paymentsの冪等化で再適用は安全)
    console.error('[kiosk] webhook apply failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'apply failed' }, { status: 500 });
  }
}
