// ⚠️ 合言葉(x-bf6-worker-key)必須。切り抜き係が元画像を取りに来る。
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerKeyValid } from '@/lib/bf6Photo';
import { getBf6CutoutWorkerKey, getBf6PhotoRaw } from '@/lib/bf6PhotoRawDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ itemId: string }> }) {
  if (!isWorkerKeyValid(req.headers.get('x-bf6-worker-key'), await getBf6CutoutWorkerKey())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { itemId } = await ctx.params;
  const n = Number(itemId);
  if (!Number.isInteger(n) || n <= 0) return new NextResponse('not found', { status: 404 });
  const raw = await getBf6PhotoRaw(n);
  if (!raw) return new NextResponse('not found', { status: 404 });
  return new NextResponse(Buffer.from(raw.bytes), {
    headers: { 'Content-Type': raw.mime, 'Cache-Control': 'no-store' },
  });
}
