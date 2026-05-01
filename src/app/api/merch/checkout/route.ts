import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/merch/checkout
 * Body: { order_id }
 * Creates a Square Checkout payment link and returns { checkout_url }.
 *
 * Requires env vars:
 *   SQUARE_ACCESS_TOKEN
 *   SQUARE_LOCATION_ID
 *   SQUARE_ENVIRONMENT=sandbox|production  (default: sandbox)
 *   NEXT_PUBLIC_APP_URL (for redirect_url)
 */
export async function POST(req: NextRequest) {
  try {
    const { order_id } = await req.json();
    if (!order_id) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }

    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const environment = process.env.SQUARE_ENVIRONMENT ?? 'sandbox';

    if (!accessToken || !locationId) {
      return NextResponse.json(
        { error: 'Square未設定: SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID が環境変数にありません' },
        { status: 503 }
      );
    }

    const order = await getOne(
      `SELECT mo.*, m.name as merch_name, m.price as merch_price
       FROM merch_orders mo
       JOIN merchandise m ON mo.merch_id = m.id
       WHERE mo.id = ?`,
      [order_id]
    );
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const variantLabel = [order.color, order.size].filter(Boolean).join(' / ');
    const itemName =
      `${order.merch_name}${variantLabel ? ` (${variantLabel})` : ''}`;

    const base =
      environment === 'production'
        ? 'https://connect.squareup.com'
        : 'https://connect.squareupsandbox.com';

    const redirectUrl =
      (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin) +
      `/shop/success?order_id=${order_id}`;

    const payload = {
      idempotency_key: `bw5-order-${order_id}-${Date.now()}`,
      order: {
        location_id: locationId,
        line_items: [
          {
            name: itemName,
            quantity: '1',
            base_price_money: {
              amount: order.merch_price as number,
              currency: 'JPY',
            },
          },
        ],
        reference_id: String(order_id),
      },
      checkout_options: {
        redirect_url: redirectUrl,
        ask_for_shipping_address: false,
      },
      pre_populated_data: order.email
        ? { buyer_email: order.email }
        : undefined,
    };

    const res = await fetch(`${base}/v2/online-checkout/payment-links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': '2024-04-17',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: 'Square checkout failed', detail: err },
        { status: 502 }
      );
    }

    const data = await res.json();
    const checkoutUrl = data?.payment_link?.url;
    if (!checkoutUrl) {
      return NextResponse.json({ error: 'No checkout URL returned' }, { status: 502 });
    }

    return NextResponse.json({ checkout_url: checkoutUrl });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Checkout creation failed' }, { status: 500 });
  }
}
