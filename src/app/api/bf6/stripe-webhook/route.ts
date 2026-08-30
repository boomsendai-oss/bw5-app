// ⚠️ 公開API(認証なし)。理由: Stripe Webhook受信用エンドポイント(Stripeのサーバが叩く)。
// 認可は Stripe-Signature ヘッダの署名検証(STRIPE_WEBHOOK_SECRET)で行い、
// 署名のない/不正な要求は400で弾く。決済確定はこのWebhookが正本(設計書v2)。
import { NextRequest, NextResponse } from 'next/server';
import { parseBf6WebhookEvent, verifyStripeSignature } from '@/lib/bf6Stripe';
import { parseKioskWebhookEvent } from '@/lib/kioskStripe';
import { parseTshirtWebhookEvent } from '@/lib/tshirtStripe';
import { applyTshirtPaidWebhook } from '@/lib/tshirtOrderDb';
import { sendTshirtOrderEmail } from '@/lib/tshirtEmail';
import { applyBf6WebhookEvent } from '@/lib/bf6Db';
import { sendBf6OrderEmail } from '@/lib/bf6Email';
import { handleBf6StreamPurchase } from '@/lib/bf6StreamDb';

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
  // Tシャツ物販(metadata.tshirt_order_id)のイベントは同一Stripeアカウントのためここに届く。
  // kioskと同じ相乗り方式(専用エンドポイントの追加登録を不要にする)。
  const tshirtEv = parseTshirtWebhookEvent(event);
  if (tshirtEv) {
    if (tshirtEv.type !== 'checkout.session.completed') {
      return NextResponse.json({ received: true, result: 'tshirt_ignored' });
    }
    try {
      const r = await applyTshirtPaidWebhook(tshirtEv);
      if (r.status === 'paid') {
        await sendTshirtOrderEmail(r.order, r.editToken, 'paid');
      }
      if (r.status === 'paid' && r.amountMismatch) {
        console.error('[tshirt] amount mismatch on order', tshirtEv.orderId, 'stripe:', tshirtEv.amountTotal);
      }
      if (r.status === 'order_not_found') {
        console.error('[tshirt] webhook order not found. session:', tshirtEv.sessionId);
      }
      return NextResponse.json({ received: true, result: `tshirt_${r.status}` });
    } catch (e) {
      // 500でStripeが自動リトライ(冪等なので再適用は安全)
      console.error('[tshirt] webhook apply failed', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'apply failed' }, { status: 500 });
    }
  }

  const ev = parseBf6WebhookEvent(event);
  if (!ev) return NextResponse.json({ error: 'invalid event' }, { status: 400 });

  // 無人物販kiosk(/api/kiosk/stripe-webhook)宛のイベントは同一Stripeアカウントのため
  // ここにも届く。BF6の注文ではないので order_not_found のログを出さず受領だけ返す。
  if (parseKioskWebhookEvent(event)?.orderId != null) {
    return NextResponse.json({ received: true, result: 'not_bf6' });
  }

  try {
    const result = await applyBf6WebhookEvent(ev, payload);
    if (result.status === 'paid') {
      if (result.amountMismatch) {
        // 金額ズレはスタッフ突合ビューで検知するが、ログにも残す(PIIなし)
        console.error('[bf6] amount mismatch on order', result.order.orderId, 'stripe:', ev.amountTotal);
      }
      await sendBf6OrderEmail(result.order, result.editToken);
      // 配信チケットを含む注文なら視聴キーを発行して別メールで送付(冪等)
      await handleBf6StreamPurchase(result.order);
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
