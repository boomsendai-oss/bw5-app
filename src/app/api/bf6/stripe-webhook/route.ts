// ⚠️ 公開API(認証なし)。理由: Stripe Webhook受信用エンドポイント(Stripeのサーバが叩く)。
// 認可は Stripe-Signature ヘッダの署名検証(STRIPE_WEBHOOK_SECRET)で行い、
// 署名のない/不正な要求は400で弾く。決済確定はこのWebhookが正本(設計書v2)。
import { NextRequest, NextResponse } from 'next/server';
import { parseBf6WebhookEvent, verifyStripeSignature } from '@/lib/bf6Stripe';
import { applyBf6WebhookEvent } from '@/lib/bf6Db';
import { sendBf6OrderEmail } from '@/lib/bf6Email';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[bf6] STRIPE_WEBHOOK_SECRET not set');
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
  const ev = parseBf6WebhookEvent(event);
  if (!ev) return NextResponse.json({ error: 'invalid event' }, { status: 400 });

  try {
    const result = await applyBf6WebhookEvent(ev, payload);
    if (result.status === 'paid') {
      if (result.amountMismatch) {
        // 金額ズレはスタッフ突合ビューで検知するが、ログにも残す(PIIなし)
        console.error('[bf6] amount mismatch on order', result.order.orderId, 'stripe:', ev.amountTotal);
      }
      await sendBf6OrderEmail(result.order, result.editToken);
    } else if (result.status === 'order_not_found') {
      console.error('[bf6] webhook order not found. session:', ev.sessionId);
    }
    return NextResponse.json({ received: true, result: result.status });
  } catch (e) {
    // 500を返すとStripeが自動リトライする(冪等なので再適用は安全)
    console.error('[bf6] webhook apply failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'apply failed' }, { status: 500 });
  }
}
