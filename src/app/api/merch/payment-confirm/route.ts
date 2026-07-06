import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/merch/payment-confirm
 * Called from /shop/success after Square Checkout redirect.
 * Body: { order_id, transaction_id }
 *
 * 顧客(無認証)から呼ばれるので認可は付けられない。代わりに次のハードニングで
 * 「未払い注文を無条件にpaidへ書き換える」攻撃面を狭める:
 *   - 確定できるのは online Square の 'awaiting_payment' 注文のみ(CAS更新)
 *   - transaction_id(Squareリダイレクトが必ず付与)が無ければ確定しない
 *   - 既に paid/delivered は冪等成功、cancelled等は409で拒否
 * ※ 完全な決済検証(Square Payments API で transaction_id と金額を照合)は
 *    SQUARE_ACCESS_TOKEN を用いた別実装が必要。ここは最低限の防御。
 */
export async function POST(req: NextRequest) {
  try {
    const { order_id, transaction_id } = await req.json();
    if (!order_id) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }
    const order = await getOne('SELECT * FROM merch_orders WHERE id = ?', [order_id]);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    // 冪等: 成功ページのリロードなどで既に確定済みならそのまま返す
    if (order.status === 'paid' || order.status === 'delivered') {
      return NextResponse.json(order);
    }
    // オンラインSquare決済の未払い注文のみ確定可。cancelled/auto_cancelled/
    // pending_cash 等を paid に書き換えさせない。
    if (order.status !== 'awaiting_payment') {
      return NextResponse.json(
        { error: 'この注文は決済確定できない状態です', status: order.status },
        { status: 409 }
      );
    }
    const tx = transaction_id != null ? String(transaction_id).trim() : '';
    if (!tx) {
      return NextResponse.json({ error: '決済情報(transaction_id)がありません' }, { status: 400 });
    }
    // CAS: awaiting_payment のときだけ paid にする(並行/二重呼び出しでも安全)
    await execute(
      "UPDATE merch_orders SET status = 'paid', square_payment_id = ? WHERE id = ? AND status = 'awaiting_payment'",
      [tx, order_id]
    );
    const updated = await getOne('SELECT * FROM merch_orders WHERE id = ?', [order_id]);
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Confirmation failed' }, { status: 500 });
  }
}
