// ⚠️ 公開API(認証なし)。理由: 受付端末はガイドアクセスでロックして使うため、
// 当日その場でログインさせるのが現実的でない(/api/bf6/photo/[slot] と同じ扱い)。
// 受け取るのは切り抜き済みのPNGのみで、氏名・連絡先は一切扱わない。
// item_id を知らないと書き込めず、上書きしかできないので、荒らされても被害は写真1枚に留まる。
import { NextRequest, NextResponse } from 'next/server';
import { validatePhotoUpload } from '@/lib/bf6Photo';
import { saveBf6Photo, deleteBf6Photo } from '@/lib/bf6PhotoDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: '受け取れませんでした' }, { status: 400 });

  const itemId = Number(form.get('itemId'));
  const file = form.get('photo');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: '画像がありません' }, { status: 400 });
  }

  const v = validatePhotoUpload({ itemId, mime: file.type, size: file.size });
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  await saveBf6Photo(itemId, file.type, bytes);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const itemId = Number(req.nextUrl.searchParams.get('itemId'));
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ ok: false, error: '出場者の指定が正しくありません' }, { status: 400 });
  }
  await deleteBf6Photo(itemId);
  return NextResponse.json({ ok: true });
}
