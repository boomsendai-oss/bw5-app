// ⚠️ 公開API(認証なし)。理由: BOOM AI（スタッフ用AI専用LINE）がグループへ返した画像・ファイルを、
//    LINEのサーバーとスタッフのスマホが取りに来るため（LINEは認証情報を持てない）。
//    推測できない token（32桁の乱数）を知っている人だけが取れる。中身はスタッフの依頼で作った制作物で、
//    会員データは扱わない。（story-media と同じく、Vercelは実行時に書き込めないのでDBに置いて配る）
import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string; name: string }> }) {
  const { token } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(token)) return new NextResponse('not found', { status: 404 });
  const row = await getOne('SELECT name, mime, bytes FROM line_ai_media WHERE token = ?', [token]).catch(() => null);
  if (!row?.bytes) return new NextResponse('not found', { status: 404 });
  const raw = row.bytes as ArrayBuffer | Uint8Array;
  const body = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const isPdf = String(row.mime) === 'application/pdf';
  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      'Content-Type': String(row.mime || 'application/octet-stream'),
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `${isPdf || String(row.mime).startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(String(row.name))}`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
