// スタッフ: Instagram DM 台帳の閲覧・手動返信・状態変更・Webhook購読。
//   GET  ?sender=<id>  … 指定スレッドのメッセージ一覧 / 省略時はスレッド一覧
//   POST {action:'reply', senderId, text} … 手動返信(24時間ウィンドウ内のみ)
//   POST {action:'status', senderId, status, note?}
//   POST {action:'subscribe'} … messages Webhook の購読を有効化(連携後に1回)
//   POST {action:'preview', text} … 自動返信ルールの判定だけ試す(送信しない)
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { listThreads, listMessages, sendDm, setThreadStatus, subscribeMessagesWebhook, withinReplyWindow } from '@/lib/instagramDm';
import { decideAutoReply, TEMPLATES } from '@/lib/instagramDmRules';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withAuth(async (req: NextRequest) => {
  const sender = new URL(req.url).searchParams.get('sender');
  if (sender) {
    const [thread, messages] = await Promise.all([
      getOne('SELECT * FROM ig_dm_threads WHERE sender_id = ?', [sender]),
      listMessages(sender),
    ]);
    return NextResponse.json({ thread, messages, canReply: thread ? withinReplyWindow(thread.last_in_at) : false });
  }
  const threads = await listThreads().catch(() => []);
  return NextResponse.json({
    threads: threads.map((t) => ({ ...t, canReply: withinReplyWindow(t.last_in_at) })),
    templates: TEMPLATES,
    webhookConfigured: !!process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
  });
});

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? '');
  try {
    if (action === 'reply') {
      const senderId = String(body.senderId ?? '');
      const text = String(body.text ?? '').trim();
      if (!senderId || !text) return NextResponse.json({ error: '宛先と本文は必須です' }, { status: 400 });
      const thread = await getOne('SELECT last_in_at FROM ig_dm_threads WHERE sender_id = ?', [senderId]);
      if (!thread) return NextResponse.json({ error: 'スレッドがありません' }, { status: 404 });
      if (!withinReplyWindow(thread.last_in_at)) {
        return NextResponse.json({ error: '相手の最終メッセージから24時間を過ぎているため、APIからは送れません。インスタアプリから返信してください。' }, { status: 409 });
      }
      const r = await sendDm(senderId, text, { sentBy: 'staff' });
      await setThreadStatus(senderId, 'done');
      return NextResponse.json({ ok: true, ...r });
    }
    if (action === 'status') {
      const senderId = String(body.senderId ?? '');
      const status = String(body.status ?? '');
      if (!senderId || !['new', 'needs_reply', 'auto_replied', 'done'].includes(status)) {
        return NextResponse.json({ error: '不正な状態です' }, { status: 400 });
      }
      await setThreadStatus(senderId, status as 'new' | 'needs_reply' | 'auto_replied' | 'done', typeof body.note === 'string' ? body.note : undefined);
      return NextResponse.json({ ok: true });
    }
    if (action === 'subscribe') {
      const r = await subscribeMessagesWebhook();
      return NextResponse.json({ ok: true, result: r });
    }
    if (action === 'preview') {
      const text = String(body.text ?? '');
      const d = decideAutoReply(text, { autoReplyKinds: [], autoRepliesLast24h: 0, inboundCountBefore: 0, now: new Date().toISOString() });
      return NextResponse.json({ decision: d });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
