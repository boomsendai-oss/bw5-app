// ⚠️ 公開API(認証なし)。理由: LINEのサーバーが直接叩くWebhook。代わりに x-line-signature
//    （チャネルシークレットの HMAC-SHA256）で呼び出し元を検証する(規約4.5の例外)。
// スタッフ用AI専用LINE公式アカウント「BOOM AI」の受け口（2026-11-20）。中身は src/lib/lineAi.ts。
// LINEは素早く200を返さないと失敗扱いにするので、処理は短く・1件失敗しても200を返す（event_id で冪等）。
import { NextRequest, NextResponse } from 'next/server';
import { channelSecret, handleEvent, verifySignature, type LineEvent } from '@/lib/lineAi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = await channelSecret();
  if (!verifySignature(raw, req.headers.get('x-line-signature'), secret)) {
    return new NextResponse('invalid signature', { status: 401 });
  }
  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: LineEvent[] }).events || [];
  } catch {
    return new NextResponse('bad json', { status: 400 });
  }
  const results: string[] = [];
  for (const ev of events) {
    try {
      results.push(await handleEvent(ev));
    } catch (e) {
      console.error(`line-ai 処理失敗: ${e instanceof Error ? e.message : e}`);
      results.push('error');
    }
  }
  return NextResponse.json({ ok: true, results });
}
