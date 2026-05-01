import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/backstage — public, returns active photos newest first
export async function GET() {
  try {
    const rows = await getAll(
      'SELECT id, image_url, caption, uploaded_at FROM backstage_photos WHERE active = 1 ORDER BY uploaded_at DESC LIMIT 100'
    );
    const visible = await getOne("SELECT value FROM settings WHERE key = 'backstage_visible'");
    const rotate = await getOne("SELECT value FROM settings WHERE key = 'backstage_rotate_ms'");
    return NextResponse.json({
      visible: visible?.value === '1',
      rotate_ms: Number(rotate?.value || 4500),
      photos: rows,
    });
  } catch (e) {
    console.error('backstage GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/backstage — upload new photo (token-protected)
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const expected = await getOne("SELECT value FROM settings WHERE key = 'backstage_upload_token'");
    if (!expected?.value || token !== expected.value) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const caption = (formData.get('caption') as string) || '';
    if (!file) {
      return NextResponse.json({ error: 'No file' }, { status: 400 });
    }

    const filename = `backstage/${Date.now()}_${file.name}`;
    const blob = await put(filename, file, { access: 'public' });

    await execute(
      'INSERT INTO backstage_photos (image_url, caption) VALUES (?, ?)',
      [blob.url, caption]
    );

    return NextResponse.json({ success: true, url: blob.url });
  } catch (e) {
    console.error('backstage POST err', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// DELETE /api/backstage?id=N — soft-delete
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const id = url.searchParams.get('id') || '';
    const expected = await getOne("SELECT value FROM settings WHERE key = 'backstage_upload_token'");
    if (!expected?.value || token !== expected.value) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }
    if (!id) return NextResponse.json({ error: 'No id' }, { status: 400 });
    await execute('UPDATE backstage_photos SET active = 0 WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
