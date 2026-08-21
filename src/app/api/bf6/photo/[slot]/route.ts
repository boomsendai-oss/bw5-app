// ⚠️ 公開API(認証なし)。理由: 会場のLED出力機がVS画面の顔写真を取りに来るため。
// 当日その場に置く機器にログインさせるのは現実的でない。返すのは当日撮影した
// 出場者の顔写真のみで、氏名・連絡先などは含まない。
import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ slot: string }> }) {
  const { slot } = await ctx.params;
  const division = req.nextUrl.searchParams.get('division') ?? '';
  const n = Number(slot);
  if (!Number.isInteger(n) || n <= 0) return new NextResponse('not found', { status: 404 });

  const row = await getOne(
    `SELECT p.mime, p.bytes
       FROM bf_draw d
       JOIN bf_photo p ON p.item_id = d.item_id
      WHERE d.slot_no = ? AND d.phase = 'bracket'
        ${division ? 'AND d.division = ?' : ''}
      LIMIT 1`,
    division ? [n, division] : [n]
  ).catch(() => null);
  if (!row?.bytes) return new NextResponse('not found', { status: 404 });

  const raw = row.bytes as ArrayBuffer | Uint8Array;
  const body = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      'Content-Type': String(row.mime || 'image/jpeg'),
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
