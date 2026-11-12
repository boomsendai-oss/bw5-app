// ⚠️ 公開API(認証なし)。理由: Stripe の試しの鍵の知らせを受ける発表会だけの受け口。認可は STRIPE_TEST_WEBHOOK_SECRET の署名で行う。
// 署名のない/不正な要求は400で弾く。形は /api/bf6/stripe-webhook と同じ（秘密だけちがう）。
// 発表会でない知らせは not_recital で受けるだけ（ほかの催しの処理は呼ばない）。BW6 発表会 段階1 Task 22。
import { NextRequest, NextResponse } from 'next/server';
import { verifyStripeSignature } from '@/lib/bf6Stripe';
import { handleRecitalWebhook } from '@/lib/recitalPayDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[recital] STRIPE_TEST_WEBHOOK_SECRET not set');
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

  const recital = await handleRecitalWebhook(event);
  if (!recital.handled) return NextResponse.json({ received: true, result: 'not_recital' });
  return NextResponse.json(recital.httpStatus === 200 ? { received: true, result: recital.result } : { error: 'apply failed' }, { status: recital.httpStatus });
}
