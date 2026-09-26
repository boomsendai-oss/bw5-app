// 配信の視聴状況。/api/staff/* は proxy.ts の matcher で認証必須(規約4.5)。
// スタッフ画面が5秒ごとに取りに来る。返すのは購入者名・メール・視聴中かどうか・端末・最終確認時刻。
import { NextResponse } from 'next/server';
import { listBf6StreamViewers } from '@/lib/bf6StreamDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const viewers = await listBf6StreamViewers();
  return NextResponse.json({ viewers }, { headers: { 'Cache-Control': 'no-store' } });
}
