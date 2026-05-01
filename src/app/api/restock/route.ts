import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne, getAll } from '@/lib/db';
import { sendRestockOrderEmail, PAYMENT_DEADLINE_LABEL } from '@/lib/email';

export const dynamic = 'force-dynamic';

const SHIPPING_FEE = 800;
const PAYMENT_DEADLINE_ISO = '2026-05-12T15:00:00+09:00';

interface RestockBody {
  merch_id: number;
  variant_id?: number | null;
  color?: string;
  size?: string;
  quantity: number;
  buyer_name: string;
  email: string;
  phone: string;
  postal_code: string;
  address: string;
  note?: string;
}

// POST /api/restock — 売り切れ商品の追加注文（後日発送）
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RestockBody;

    // バリデーション
    const required = ['merch_id', 'quantity', 'buyer_name', 'email', 'phone', 'postal_code', 'address'] as const;
    for (const k of required) {
      if (!body[k as keyof RestockBody] && body[k as keyof RestockBody] !== 0) {
        return NextResponse.json({ error: `必須項目が未入力です: ${k}` }, { status: 400 });
      }
    }
    if (!/^\S+@\S+\.\S+$/.test(body.email)) {
      return NextResponse.json({ error: 'メールアドレスの形式が正しくありません' }, { status: 400 });
    }
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 10) {
      return NextResponse.json({ error: '数量は1〜10で指定してください' }, { status: 400 });
    }

    // シールは追加注文対象外
    if (body.merch_id === 8) {
      return NextResponse.json({ error: 'この商品は追加注文の対象外です' }, { status: 400 });
    }

    const merch = await getOne('SELECT id, name, price FROM merchandise WHERE id = ?', [body.merch_id]);
    if (!merch) {
      return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });
    }

    const unitPrice = Number(merch.price) || 0;
    const totalAmount = unitPrice * body.quantity + SHIPPING_FEE;

    const result = await execute(
      `INSERT INTO restock_orders
        (merch_id, variant_id, color, size, quantity, buyer_name, email, phone,
         postal_code, address, unit_price, shipping_fee, total_amount,
         status, payment_deadline, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?)`,
      [
        body.merch_id,
        body.variant_id ?? null,
        body.color ?? '',
        body.size ?? '',
        body.quantity,
        body.buyer_name,
        body.email,
        body.phone,
        body.postal_code,
        body.address,
        unitPrice,
        SHIPPING_FEE,
        totalAmount,
        PAYMENT_DEADLINE_ISO,
        body.note ?? '',
      ]
    );

    const orderId = Number(result.lastInsertRowid);

    // メール送信（失敗してもDB登録は維持）
    try {
      await sendRestockOrderEmail({
        to: body.email,
        buyerName: body.buyer_name,
        merchName: String(merch.name),
        color: body.color ?? '',
        size: body.size ?? '',
        quantity: body.quantity,
        unitPrice,
        shippingFee: SHIPPING_FEE,
        totalAmount,
        postalCode: body.postal_code,
        address: body.address,
        phone: body.phone,
        orderId,
      });
    } catch (e) {
      console.error('[restock] email failed but order saved', e);
    }

    return NextResponse.json({
      success: true,
      order_id: orderId,
      total_amount: totalAmount,
      shipping_fee: SHIPPING_FEE,
      payment_deadline: PAYMENT_DEADLINE_LABEL,
    });
  } catch (e) {
    console.error('restock POST err', e);
    return NextResponse.json({ error: '注文の登録に失敗しました' }, { status: 500 });
  }
}

// GET /api/restock?token=XXX — 管理画面用の一覧
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const expected = await getOne("SELECT value FROM settings WHERE key = 'admin_password'");
    if (!expected?.value || token !== expected.value) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const orders = await getAll(`
      SELECT r.*, m.name AS merch_name
      FROM restock_orders r
      LEFT JOIN merchandise m ON m.id = r.merch_id
      ORDER BY r.created_at DESC
    `);
    return NextResponse.json({ orders });
  } catch (e) {
    console.error('restock GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
