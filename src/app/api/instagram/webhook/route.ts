// Instagram DM Webhook (Meta → ここ)。
//   GET  = 購読の検証(hub.mode=subscribe / hub.verify_token / hub.challenge)
//   POST = メッセージ受信通知。X-Hub-Signature-256 を INSTAGRAM_APP_SECRET で検証してから処理。
// Metaは数秒以内に200を返さないと再送してくるので、処理は短く・失敗しても200を返す(台帳側で冪等)。
import { NextRequest, NextResponse } from 'next/server';
import { verifySignature, parseWebhookEvents, handleInboundMessage } from '@/lib/instagramDm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const raw = await req.text();
  if (!appSecret || !verifySignature(raw, req.headers.get('x-hub-signature-256'), appSecret)) {
    return new NextResponse('invalid signature', { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse('bad json', { status: 400 });
  }
  const events = parseWebhookEvents(payload);
  const results: unknown[] = [];
  for (const ev of events) {
    try {
      results.push(await handleInboundMessage(ev));
    } catch (e) {
      console.error(`DM処理失敗 sender=${ev.senderId}: ${e instanceof Error ? e.message : e}`);
      results.push({ error: true });
    }
  }
  return NextResponse.json({ ok: true, handled: results.length });
}
