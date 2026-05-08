import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll, getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/video-orders — admin/staff use; returns video preorders
// マッピング: video_preorders → 管理画面が期待する VideoOrder 型
export async function GET() {
  try {
    const rows = await getAll(
      `SELECT v.id, v.buyer_name, v.email, v.phone, v.note, v.status, v.created_at,
              v.merch_id, m.name AS merch_name
       FROM video_preorders v
       LEFT JOIN merchandise m ON m.id = v.merch_id
       ORDER BY v.created_at DESC`
    );
    // 管理画面の VideoOrder 型に合わせる（payment_method は固定値）
    const orders = rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      buyer_name: r.buyer_name,
      email: r.email,
      phone: r.phone,
      note: r.note,
      payment_method: 'online_video',
      status: r.status,
      created_at: r.created_at,
      merch_name: r.merch_name,
    }));
    return NextResponse.json({ orders });
  } catch (e) {
    console.error('video-orders GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// PATCH /api/video-orders — update status
// body: { id: number, status: 'waiting' | 'paid' | 'delivered' | 'cancelled' }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body;
    if (!id || !status) {
      return NextResponse.json({ error: 'id と status は必須です' }, { status: 400 });
    }
    const allowed = ['waiting', 'paid', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    const exists = await getOne('SELECT id FROM video_preorders WHERE id = ?', [id]);
    if (!exists) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    await execute('UPDATE video_preorders SET status = ? WHERE id = ?', [status, id]);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('video-orders PATCH err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// DELETE /api/video-orders?id=X — soft delete (mark cancelled). Or hard delete if force=true.
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = Number(url.searchParams.get('id') || 0);
    const force = url.searchParams.get('force') === '1';
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }
    if (force) {
      await execute('DELETE FROM video_preorders WHERE id = ?', [id]);
    } else {
      await execute('UPDATE video_preorders SET status = ? WHERE id = ?', ['cancelled', id]);
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('video-orders DELETE err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
