// Tシャツ注文の DB アクセス層。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
// PII: 注文者の住所・電話は「郵送希望の注文」にしか存在しない。
//      公開側は edit_token 一致の1件しか読めず、列挙する関数は公開側に渡さない。
import { getAll, getOne, execute } from '@/lib/db';
import {
  calcOrderTotal,
  defaultTshirtSettings,
  generateOrderToken,
  isTshirtSize,
  parseSizeChart,
  type PaymentMethod,
  type TshirtSettings,
  type TshirtSize,
  type ValidatedOrder,
} from '@/lib/tshirtOrder';

export interface StoredOrder {
  id: number;
  name: string;
  size: TshirtSize;
  qty: number;
  wantsShipping: boolean;
  address: string;
  phone: string;
  email: string;
  unitPrice: number;
  shippingFee: number;
  totalAmount: number;
  handedOver: boolean;
  paid: boolean;
  paymentMethod: PaymentMethod;
  stripeSessionId: string;
  amountMismatch: boolean;
  createdAt: string;
  updatedAt: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB行は動的キーアクセス */
function toOrder(r: any): StoredOrder {
  const size = String(r.size);
  return {
    id: Number(r.id),
    name: String(r.customer_name),
    size: (isTshirtSize(size) ? size : 'M') as TshirtSize,
    qty: Number(r.qty),
    wantsShipping: Number(r.wants_shipping) === 1,
    address: String(r.shipping_address ?? ''),
    phone: String(r.shipping_phone ?? ''),
    email: String(r.email ?? ''),
    unitPrice: Number(r.unit_price),
    shippingFee: Number(r.shipping_fee),
    totalAmount: Number(r.total_amount),
    handedOver: Number(r.handed_over) === 1,
    paid: Number(r.paid) === 1,
    paymentMethod: r.payment_method === 'stripe' ? 'stripe' : 'cash',
    stripeSessionId: String(r.stripe_session_id ?? ''),
    amountMismatch: Number(r.amount_mismatch ?? 0) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// 監査ログ。変更・削除で「変更前」を必ず残す(2026-08-31の上書き消失事故を受けて。
// 復元を推測でなく記録から行えるようにする)。失敗しても本処理は止めない。
/* eslint-disable @typescript-eslint/no-explicit-any -- スナップショットは行そのまま */
async function logOrderAudit(orderId: number | null, action: string, before: any, after: any): Promise<void> {
  try {
    await execute(
      'INSERT INTO tshirt_order_audit (order_id, action, snapshot_before, snapshot_after, created_at) VALUES (?, ?, ?, ?, ?)',
      [orderId, action, before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '', new Date().toISOString()]
    );
  } catch (e) {
    console.error('[tshirt] audit log failed', action, e instanceof Error ? e.message : e);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// 設定行が無ければデフォルトを返す(永続化はしない=公開/スタッフ双方から安全に読める)。
export async function resolveTshirtSettings(): Promise<TshirtSettings> {
  const row = await getOne('SELECT * FROM tshirt_order_settings WHERE id = 1');
  const d = defaultTshirtSettings();
  if (!row) return d;
  return {
    productName: String(row.product_name || d.productName),
    unitPrice: Number(row.unit_price ?? d.unitPrice),
    shippingFee: Number(row.shipping_fee ?? d.shippingFee),
    imageUrl: String(row.image_url || d.imageUrl),
    openAt: String(row.open_at ?? ''),
    closeAt: String(row.close_at ?? ''),
    isOpen: Number(row.is_open ?? 1) === 1,
    introMd: String(row.intro_md ?? ''),
    pickupNote: String(row.pickup_note ?? ''),
    thanksNote: String(row.thanks_note ?? ''),
    sizeChart: parseSizeChart(String(row.size_chart_json ?? '')),
  };
}

export async function saveTshirtSettings(s: TshirtSettings): Promise<void> {
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO tshirt_order_settings
       (id, product_name, unit_price, shipping_fee, image_url, open_at, close_at, is_open, intro_md, pickup_note, thanks_note, size_chart_json, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       product_name = excluded.product_name,
       unit_price = excluded.unit_price,
       shipping_fee = excluded.shipping_fee,
       image_url = excluded.image_url,
       open_at = excluded.open_at,
       close_at = excluded.close_at,
       is_open = excluded.is_open,
       intro_md = excluded.intro_md,
       pickup_note = excluded.pickup_note,
       thanks_note = excluded.thanks_note,
       size_chart_json = excluded.size_chart_json,
       updated_at = excluded.updated_at`,
    [
      s.productName, s.unitPrice, s.shippingFee, s.imageUrl,
      s.openAt, s.closeAt, s.isOpen ? 1 : 0,
      s.introMd, s.pickupNote, s.thanksNote, JSON.stringify(s.sizeChart), now,
    ]
  );
}

// 注文を1件作成し、本人だけが後から確認・編集できるトークンを返す。
// 金額は注文時点の設定で確定させ、後から値段を変えても過去の注文はずれない。
export async function createOrder(data: ValidatedOrder): Promise<string> {
  const s = await resolveTshirtSettings();
  const token = generateOrderToken();
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO tshirt_orders
       (edit_token, customer_name, size, qty, wants_shipping, shipping_address, shipping_phone, email,
        unit_price, shipping_fee, total_amount, payment_method, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token, data.name, data.size, data.qty, data.wantsShipping ? 1 : 0,
      data.address, data.phone, data.email ?? '',
      s.unitPrice, data.wantsShipping ? s.shippingFee : 0,
      calcOrderTotal(data.qty, data.wantsShipping, s),
      data.paymentMethod ?? 'cash',
      now, now,
    ]
  );
  const createdRow = await getOne('SELECT * FROM tshirt_orders WHERE edit_token = ?', [token]);
  if (createdRow) await logOrderAudit(Number(createdRow.id), 'create', null, createdRow);
  return token;
}

// トークン一致の1件だけ返す(列挙不可)。無ければ null。
export async function loadOrderByToken(token: string): Promise<StoredOrder | null> {
  if (!token) return null;
  const row = await getOne('SELECT * FROM tshirt_orders WHERE edit_token = ?', [token]);
  return row ? toOrder(row) : null;
}

// トークン一致の注文を差し替える。合計金額は現在の設定で再計算する。
export async function updateOrderByToken(token: string, data: ValidatedOrder): Promise<boolean> {
  if (!token) return false;
  const row = await getOne('SELECT * FROM tshirt_orders WHERE edit_token = ?', [token]);
  if (!row) return false;
  // カード決済済みの注文は金額が確定しているため、内容変更を受け付けない
  if (Number(row.paid) === 1 && row.payment_method === 'stripe') return false;
  const s = await resolveTshirtSettings();
  await execute(
    `UPDATE tshirt_orders
        SET customer_name = ?, size = ?, qty = ?, wants_shipping = ?,
            shipping_address = ?, shipping_phone = ?, email = ?,
            unit_price = ?, shipping_fee = ?, total_amount = ?, payment_method = ?, updated_at = ?
      WHERE edit_token = ?`,
    [
      data.name, data.size, data.qty, data.wantsShipping ? 1 : 0,
      data.address, data.phone, data.email ?? '',
      s.unitPrice, data.wantsShipping ? s.shippingFee : 0,
      calcOrderTotal(data.qty, data.wantsShipping, s),
      data.paymentMethod ?? 'cash',
      new Date().toISOString(), token,
    ]
  );
  const afterRow = await getOne('SELECT * FROM tshirt_orders WHERE edit_token = ?', [token]);
  await logOrderAudit(Number(row.id), 'update', row, afterRow);
  return true;
}

// スタッフ用: 全注文を返す(トークンは返さない)。
export async function listOrders(): Promise<StoredOrder[]> {
  const rows = await getAll('SELECT * FROM tshirt_orders ORDER BY created_at ASC, id ASC');
  return rows.map(toOrder);
}

export async function setOrderFlags(id: number, flags: { handedOver?: boolean; paid?: boolean }): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (flags.handedOver !== undefined) { sets.push('handed_over = ?'); args.push(flags.handedOver ? 1 : 0); }
  if (flags.paid !== undefined) { sets.push('paid = ?'); args.push(flags.paid ? 1 : 0); }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(new Date().toISOString(), id);
  await execute(`UPDATE tshirt_orders SET ${sets.join(', ')} WHERE id = ?`, args);
}

export async function deleteOrder(id: number): Promise<void> {
  const before = await getOne('SELECT * FROM tshirt_orders WHERE id = ?', [id]);
  await execute('DELETE FROM tshirt_orders WHERE id = ?', [id]);
  if (before) await logOrderAudit(id, 'delete', before, null);
}

// ============================================================
// Stripe決済(Webhookが正本)
// ============================================================

export async function attachStripeSession(orderId: number, sessionId: string): Promise<void> {
  await execute(
    'UPDATE tshirt_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?',
    [sessionId, new Date().toISOString(), orderId]
  );
}

export interface TshirtPaidWebhookInput {
  orderId: number;
  sessionId: string;
  paymentIntentId: string;
  amountTotal: number | null;
}

export type TshirtWebhookResult =
  | { status: 'paid'; amountMismatch: boolean; order: StoredOrder; editToken: string }
  | { status: 'already_paid' }
  | { status: 'order_not_found' };

// checkout.session.completed の適用。二度来ても安全(冪等)。
// 金額ズレは黙って通さず amount_mismatch に印を付けてスタッフ画面で追えるようにする。
export async function applyTshirtPaidWebhook(ev: TshirtPaidWebhookInput): Promise<TshirtWebhookResult> {
  const row = await getOne('SELECT * FROM tshirt_orders WHERE id = ?', [ev.orderId]);
  if (!row) return { status: 'order_not_found' };
  if (Number(row.paid) === 1) return { status: 'already_paid' };
  const mismatch = ev.amountTotal != null && ev.amountTotal !== Number(row.total_amount);
  await execute(
    `UPDATE tshirt_orders
        SET paid = 1, payment_method = 'stripe', stripe_session_id = ?,
            stripe_payment_intent = ?, amount_mismatch = ?, updated_at = ?
      WHERE id = ?`,
    [ev.sessionId, ev.paymentIntentId, mismatch ? 1 : 0, new Date().toISOString(), ev.orderId]
  );
  await logOrderAudit(ev.orderId, 'paid_webhook', row, { sessionId: ev.sessionId, paymentIntentId: ev.paymentIntentId, amountTotal: ev.amountTotal });
  return {
    status: 'paid',
    amountMismatch: mismatch,
    order: { ...toOrder(row), paid: true, paymentMethod: 'stripe' },
    editToken: String(row.edit_token),
  };
}
