// 配信の視聴状況。スタッフ画面が5秒ごとに取りに来る。返すのは購入者名・メール・視聴中かどうか・端末・最終確認時刻。
// ⚠️ proxy は cookie の有無しか見ないため、withAuth でセッションを本検証する(規約4.5)。
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { listBf6StreamViewers } from '@/lib/bf6StreamDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withAuth(async () => {
  const viewers = await listBf6StreamViewers();
  return NextResponse.json({ viewers }, { headers: { 'Cache-Control': 'no-store' } });
});
