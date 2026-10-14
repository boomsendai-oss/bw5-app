// 予約投稿(GBP・Facebookページ)の一覧と本文の訂正。
// 予約投稿は月次ドラフトから自動作成されるが(gbp-post-scheduler)、作成後に誤記が見つかっても
// 直す手段が管理画面の手作業しかなかったため追加(2026-10-14: 体験会の会場表記の訂正)。
// 公開時刻・ボタンは触らず、本文(GBP=summary / FB=message)だけを差し替える。
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { getGbpAccessToken, listGbpLocalPosts, patchGbpLocalPostSummary, createGbpPhotoPost, deleteGbpLocalPost } from '@/lib/gbp';
import { listScheduledPagePosts, updatePagePostMessage, schedulePagePhotoPost, deletePagePost } from '@/lib/facebookPage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = withAuth(async () => {
  const token = await getGbpAccessToken();
  const gbp = (await listGbpLocalPosts(token))
    .filter((p) => p.state !== 'LIVE')
    .map((p) => ({ name: p.name, state: p.state, summary: p.summary, scheduledTime: (p as { scheduledTime?: string }).scheduledTime }));
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

// 画像つきで作り直す用(予約の差し替え・2026-10-14 TAROの依頼で10/15予約→当日12:30画像つきに変更)。
// body: { target: 'gbp', summary, imageUrl, ctaUrl, scheduledTimeUtc? } | { target: 'fb', message, imageUrl, scheduledTimeUtc }
export const POST = withAuth(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (!b.imageUrl?.startsWith('https://')) return NextResponse.json({ error: 'imageUrl(https)が必要です' }, { status: 400 });
  if (b.target === 'gbp' && b.summary && b.ctaUrl) {
    const token = await getGbpAccessToken();
    const r = await createGbpPhotoPost(token, { summary: b.summary, imageUrl: b.imageUrl, ctaUrl: b.ctaUrl, scheduledTimeUtc: b.scheduledTimeUtc || undefined });
    return NextResponse.json({ ok: true, name: r.name, state: r.state });
  }
  if (b.target === 'fb' && b.message && b.scheduledTimeUtc) {
    const r = await schedulePagePhotoPost(b.message, b.imageUrl, b.scheduledTimeUtc);
    return NextResponse.json({ ok: true, id: r.id });
  }
  return NextResponse.json({ error: 'target(gbp|fb) と本文が必要です' }, { status: 400 });
});

// body: { target: 'gbp', name } | { target: 'fb', id }  公開前の予約投稿の取り消し用
export const DELETE = withAuth(async (req: NextRequest) => {
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (b.target === 'gbp' && b.name) {
    await deleteGbpLocalPost(await getGbpAccessToken(), b.name);
    return NextResponse.json({ ok: true });
  }
  if (b.target === 'fb' && b.id) {
    await deletePagePost(b.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'target と name/id が必要です' }, { status: 400 });
});
