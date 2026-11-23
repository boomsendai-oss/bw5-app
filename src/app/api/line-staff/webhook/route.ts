// ⚠️ 公開API(認証なし)。理由: LINEのサーバーが直接叩くWebhook。代わりに x-line-signature
//    （チャネルシークレットの HMAC-SHA256）で呼び出し元を検証する(規約4.5の例外)。
// スタジオとのやりとり用LINE公式アカウント「BOOMスタッフアカウント」の受け口（2026-11-23）。中身は src/lib/lineStaff.ts。
// ここからは何も返さない。1件失敗しても200を返す（message_id で冪等）。
import { NextRequest, NextResponse } from 'next/server';
import type { LineEvent } from '@/lib/lineAi';
import { handleStaffEvent, staffChannelSecret, verifySignature } from '@/lib/lineStaff';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = await staffChannelSecret();
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
      results.push(await handleStaffEvent(ev));
    } catch (e) {
      console.error(`line-staff 処理失敗: ${e instanceof Error ? e.message : e}`);
      results.push('error');
    }
  }
  return NextResponse.json({ ok: true, results });
}
