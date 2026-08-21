// Tシャツ注文の DB アクセス層。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
// PII: 注文者の住所・電話は「郵送希望の注文」にしか存在しない。
//      公開側は edit_token 一致の1件しか読めず、列挙する関数は公開側に渡さない。
import { getAll, getOne, execute } from '@/lib/db';
import {
  calcOrderTotal,
  defaultTshirtSettings,
  generateOrderToken,
  isTshirtSize,
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
  unitPrice: number;
  shippingFee: number;
  totalAmount: number;
  handedOver: boolean;
  paid: boolean;
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
    unitPrice: Number(r.unit_price),
    shippingFee: Number(r.shipping_fee),
    totalAmount: Number(r.total_amount),
    handedOver: Number(r.handed_over) === 1,
    paid: Number(r.paid) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
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
  };
}

export async function saveTshirtSettings(s: TshirtSettings): Promise<void> {
  const now = new Date().toISOString();
  await execute(
    `INSERT INTO tshirt_order_settings
       (id, product_name, unit_price, shipping_fee, image_url, open_at, close_at, is_open, intro_md, pickup_note, thanks_note, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       updated_at = excluded.updated_at`,
    [
      s.productName, s.unitPrice, s.shippingFee, s.imageUrl,
      s.openAt, s.closeAt, s.isOpen ? 1 : 0,
      s.introMd, s.pickupNote, s.thanksNote, now,
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
       (edit_token, customer_name, size, qty, wants_shipping, shipping_address, shipping_phone,
        unit_price, shipping_fee, total_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      token, data.name, data.size, data.qty, data.wantsShipping ? 1 : 0,
      data.address, data.phone,
      s.unitPrice, data.wantsShipping ? s.shippingFee : 0,
      calcOrderTotal(data.qty, data.wantsShipping, s),
      now, now,
    ]
  );
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
  const row = await getOne('SELECT id FROM tshirt_orders WHERE edit_token = ?', [token]);
  if (!row) return false;
  const s = await resolveTshirtSettings();
  await execute(
    `UPDATE tshirt_orders
        SET customer_name = ?, size = ?, qty = ?, wants_shipping = ?,
            shipping_address = ?, shipping_phone = ?,
            unit_price = ?, shipping_fee = ?, total_amount = ?, updated_at = ?
      WHERE edit_token = ?`,
    [
      data.name, data.size, data.qty, data.wantsShipping ? 1 : 0,
      data.address, data.phone,
      s.unitPrice, data.wantsShipping ? s.shippingFee : 0,
      calcOrderTotal(data.qty, data.wantsShipping, s),
      new Date().toISOString(), token,
    ]
  );
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
  await execute('DELETE FROM tshirt_orders WHERE id = ?', [id]);
}
