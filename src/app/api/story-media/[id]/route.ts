// ⚠️ 公開API(認証なし)。理由: アプリから上げたストーリー素材を **Instagramのサーバーが取りに来る**
// ため。Meta側は認証情報を持てないので、ここは誰でもGETできる必要がある。
// 露出するのはTARO自身が投稿用に上げた画像/動画だけで、個人情報・会員データは扱わない。
// (Vercelは実行時に public/ へ書き込めないため、素材はDBに置いてここで配信している)
import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return new NextResponse('not found', { status: 404 });

  const row = await getOne('SELECT mime, bytes FROM story_upload WHERE id = ?', [n]).catch(() => null);
  if (!row?.bytes) return new NextResponse('not found', { status: 404 });

  const raw = row.bytes as ArrayBuffer | Uint8Array;
  const body = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      'Content-Type': String(row.mime || 'application/octet-stream'),
      'Content-Length': String(body.byteLength),
      // Instagramは取得を数回リトライする。素材は上書きされない(新規は別id)ので長めでよい。
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
