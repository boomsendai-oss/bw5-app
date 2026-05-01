import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne, getAll } from '@/lib/db';
import { sendVideoPreorderEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

interface PreorderBody {
  merch_id: number;
  buyer_name: string;
  email: string;
  phone: string;
  note?: string;
}

// POST /api/video-preorder — 映像データ販売の事前予約
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PreorderBody;

    const required = ['merch_id', 'buyer_name', 'email', 'phone'] as const;
    for (const k of required) {
      if (!body[k as keyof PreorderBody] && body[k as keyof PreorderBody] !== 0) {
        return NextResponse.json({ error: `必須項目が未入力です: ${k}` }, { status: 400 });
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(body.email)) {
      return NextResponse.json({ error: 'メールアドレスの形式が正しくありません' }, { status: 400 });
    }

    const merch = await getOne('SELECT id, name, price FROM merchandise WHERE id = ?', [body.merch_id]);
    if (!merch) {
      return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });
    }

    const result = await execute(
      `INSERT INTO video_preorders (merch_id, buyer_name, email, phone, note, status)
       VALUES (?, ?, ?, ?, ?, 'waiting')`,
      [body.merch_id, body.buyer_name, body.email, body.phone, body.note ?? '']
    );

    const preorderId = Number(result.lastInsertRowid);

    try {
      await sendVideoPreorderEmail({
        to: body.email,
        buyerName: body.buyer_name,
        phone: body.phone,
        preorderId,
        merchName: String(merch.name),
        price: Number(merch.price) || 0,
      });
    } catch (e) {
      console.error('[video-preorder] email failed but record saved', e);
    }

    return NextResponse.json({ success: true, preorder_id: preorderId });
  } catch (e) {
    console.error('video-preorder POST err', e);
    return NextResponse.json({ error: '予約の登録に失敗しました' }, { status: 500 });
  }
}

// GET /api/video-preorder?token=XXX — 管理者用一覧
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const expected = await getOne("SELECT value FROM settings WHERE key = 'admin_password'");
    if (!expected?.value || token !== expected.value) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const rows = await getAll(`
      SELECT v.*, m.name AS merch_name
      FROM video_preorders v
      LEFT JOIN merchandise m ON m.id = v.merch_id
      ORDER BY v.created_at DESC
    `);
    return NextResponse.json({ preorders: rows });
  } catch (e) {
    console.error('video-preorder GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
