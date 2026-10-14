// 予約投稿(GBP・Facebookページ)の一覧と本文の訂正。
// 予約投稿は月次ドラフトから自動作成されるが(gbp-post-scheduler)、作成後に誤記が見つかっても
// 直す手段が管理画面の手作業しかなかったため追加(2026-10-14: 体験会の会場表記の訂正)。
// 公開時刻・ボタンは触らず、本文(GBP=summary / FB=message)だけを差し替える。
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { getGbpAccessToken, listGbpLocalPosts, patchGbpLocalPostSummary } from '@/lib/gbp';
import { listScheduledPagePosts, updatePagePostMessage } from '@/lib/facebookPage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = withAuth(async () => {
  const token = await getGbpAccessToken();
  const gbp = (await listGbpLocalPosts(token))
    .filter((p) => p.state !== 'LIVE')
    .map((p) => ({ name: p.name, state: p.state, summary: p.summary }));
  const fb = await listScheduledPagePosts().catch((e) => ({ error: String(e) }));
  return NextResponse.json({ gbp, fb });
});

// body: { target: 'gbp', name, summary } | { target: 'fb', id, message }
export const PATCH = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.target === 'gbp' && typeof body.name === 'string' && typeof body.summary === 'string' && body.summary.trim()) {
    const token = await getGbpAccessToken();
    const r = await patchGbpLocalPostSummary(token, body.name, body.summary);
    return NextResponse.json({ ok: true, state: r.state, summary: r.summary });
  }
  if (body.target === 'fb' && typeof body.id === 'string' && typeof body.message === 'string' && body.message.trim()) {
    await updatePagePostMessage(body.id, body.message);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'target(gbp|fb) と本文が必要です' }, { status: 400 });
});
