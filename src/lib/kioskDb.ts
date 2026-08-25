// 無人物販kiosk の DB 層。設計書: docs/superpowers/specs/2026-08-25-kiosk-design.md
// 在庫モデル:
//   - 実在庫(stock)を減らすのは決済確定時のみ(Webhook paid化 / 現金確定)
//   - 販売可能数 = stock − Σ(pending注文のqty)。仮押さえはpending注文の存在で表現する
//   - 期限切れpendingは読み取り系の入口で sweep して解放する(BF6方式)
// 決済の正本はWebhook。金額は常にDB価格から再計算し、クライアント申告額を使わない。
import { execute, getAll, getOne, withWriteTx, initDb } from '@/lib/db';
import type { Transaction } from '@libsql/client';

export { KIOSK_HOLD_MINUTES, KIOSK_MAX_QTY_PER_ORDER } from '@/lib/kioskShared';
import { KIOSK_HOLD_MINUTES, KIOSK_MAX_QTY_PER_ORDER } from '@/lib/kioskShared';

function nowIso(): string {
  return new Date().toISOString();
}

export interface KioskCartItem {
  productId: number;
  variantId?: number | null;
  qty: number;
}

export interface KioskSale {
  id: number;
  name: string;
  eventDate: string;
  active: boolean;
}

export interface KioskVariantView {
  id: number;
  label: string;
  color: string;
  size: string;
  stock: number;
  available: number;
}

export interface KioskProductView {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  description: string;
  stock: number;
  available: number;
  active: boolean;
  variants: KioskVariantView[];
}

export type CreateKioskOrderResult =
  | { ok: true; orderId: number; amountTotal: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// 販売会・商品
// ---------------------------------------------------------------------------

export async function createKioskSale(name: string, eventDate: string): Promise<number> {
  await initDb();
  const res = await execute('INSERT INTO kiosk_sales (name, event_date, active, created_at) VALUES (?, ?, 0, ?)', [
    name,
    eventDate,
    nowIso(),
  ]);
  return Number(res.lastInsertRowid);
}

/** activeな販売会は常に1つ。切り替えると他は自動で下りる。 */
export async function setActiveKioskSale(saleId: number): Promise<void> {
  await initDb();
  await execute('UPDATE kiosk_sales SET active = CASE WHEN id = ? THEN 1 ELSE 0 END', [saleId]);
}

export async function getActiveKioskSale(): Promise<KioskSale | null> {
  await initDb();
  const row = await getOne('SELECT * FROM kiosk_sales WHERE active = 1 LIMIT 1');
  if (!row) return null;
  return {
    id: Number(row.id),
    name: String(row.name),
    eventDate: String(row.event_date ?? ''),
    active: true,
  };
}

export async function addKioskProduct(
  saleId: number,
  p: { name: string; price: number; stock?: number; imageUrl?: string; description?: string; sortOrder?: number }
): Promise<number> {
  await initDb();
  const res = await execute(
    'INSERT INTO kiosk_products (sale_id, name, price, image_url, description, stock, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
    [saleId, p.name, p.price, p.imageUrl ?? '', p.description ?? '', p.stock ?? 0, p.sortOrder ?? 0]
  );
  return Number(res.lastInsertRowid);
}

export async function addKioskVariant(productId: number, label: string, stock: number): Promise<number> {
  return addKioskVariantCS(productId, { color: '', size: label, stock });
}

/** カラー/サイズを分けて登録する。labelは表示・注文スナップショット用の合成文字列。 */
export async function addKioskVariantCS(
  productId: number,
  v: { color: string; size: string; stock: number }
): Promise<number> {
  await initDb();
  const label = [v.color, v.size].filter(Boolean).join(' ');
  const res = await execute(
    'INSERT INTO kiosk_product_variants (product_id, label, color, size, stock, sort_order) VALUES (?, ?, ?, ?, ?, 0)',
    [productId, label, v.color, v.size, v.stock]
  );
  return Number(res.lastInsertRowid);
}

export async function updateKioskSale(id: number, name: string, eventDate: string): Promise<void> {
  await initDb();
  await execute('UPDATE kiosk_sales SET name = ?, event_date = ? WHERE id = ?', [name, eventDate, id]);
}

// ---------------------------------------------------------------------------
// 仮押さえの集計
// ---------------------------------------------------------------------------

/** 期限切れのpendingをexpired化して仮押さえを解放する。読み取り系の入口で必ず呼ぶ。 */
export async function sweepExpiredKioskOrders(): Promise<number> {
  await initDb();
  const res = await execute(
    "UPDATE kiosk_orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at != '' AND expires_at < ?",
    [nowIso(), nowIso()]
  );
  return Number(res.rowsAffected ?? 0);
}

interface PendingRow {
  product_id: number;
  variant_id: number | null;
  qty: number;
}

/** pending注文が押さえている数量を product/variant 単位で集計する。 */
function aggregateHolds(rows: PendingRow[]): { byProduct: Map<number, number>; byVariant: Map<number, number> } {
  const byProduct = new Map<number, number>();
  const byVariant = new Map<number, number>();
  for (const r of rows) {
    const qty = Number(r.qty);
    if (r.variant_id != null) {
      byVariant.set(Number(r.variant_id), (byVariant.get(Number(r.variant_id)) ?? 0) + qty);
    } else {
      byProduct.set(Number(r.product_id), (byProduct.get(Number(r.product_id)) ?? 0) + qty);
    }
  }
  return { byProduct, byVariant };
}

const PENDING_HOLDS_SQL = `SELECT i.product_id, i.variant_id, i.qty
   FROM kiosk_order_items i JOIN kiosk_orders o ON o.id = i.order_id
   WHERE o.status = 'pending' AND o.sale_id = ?`;

/** 販売会のカタログ(販売可能数つき)。iPad表示とスタッフ画面の両方が使う。 */
export async function getKioskCatalog(saleId: number): Promise<KioskProductView[]> {
  await initDb();
  await sweepExpiredKioskOrders();
  const products = await getAll('SELECT * FROM kiosk_products WHERE sale_id = ? ORDER BY sort_order, id', [saleId]);
  const variants = await getAll(
    'SELECT v.* FROM kiosk_product_variants v JOIN kiosk_products p ON p.id = v.product_id WHERE p.sale_id = ? ORDER BY v.sort_order, v.id',
    [saleId]
  );
  const holds = aggregateHolds((await getAll(PENDING_HOLDS_SQL, [saleId])) as PendingRow[]);

  return products.map((p) => {
    const pv = variants
      .filter((v) => Number(v.product_id) === Number(p.id))
      .map((v) => ({
        id: Number(v.id),
        label: String(v.label),
        color: String(v.color ?? ''),
        size: String(v.size ?? ''),
        stock: Number(v.stock),
        available: Math.max(0, Number(v.stock) - (holds.byVariant.get(Number(v.id)) ?? 0)),
      }));
    const available =
      pv.length > 0
        ? pv.reduce((s, v) => s + v.available, 0)
        : Math.max(0, Number(p.stock) - (holds.byProduct.get(Number(p.id)) ?? 0));
    return {
      id: Number(p.id),
      name: String(p.name),
      price: Number(p.price),
      imageUrl: String(p.image_url ?? ''),
      description: String(p.description ?? ''),
      stock: Number(p.stock),
      available,
      active: Number(p.active) === 1,
      variants: pv,
    };
  });
}

// ---------------------------------------------------------------------------
// 注文作成(共通)
// ---------------------------------------------------------------------------

interface ResolvedItem {
  productId: number;
  variantId: number | null;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
}

/**
 * カートを検証して明細に解決する(価格・商品名はDBからスナップショット)。
 * 在庫チェックは呼び出し側のトランザクション内で行う。
 */
async function resolveItems(tx: Transaction, saleId: number, items: KioskCartItem[]): Promise<ResolvedItem[]> {
  if (items.length === 0) throw new Error('カートが空です');
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  if (totalQty <= 0) throw new Error('数量が不正です');
  if (totalQty > KIOSK_MAX_QTY_PER_ORDER) {
    throw new Error(`一度に購入できるのは合計${KIOSK_MAX_QTY_PER_ORDER}点までです`);
  }
  const resolved: ResolvedItem[] = [];
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) throw new Error('数量が不正です');
    const p = (
      await tx.execute({
        sql: 'SELECT * FROM kiosk_products WHERE id = ? AND sale_id = ? AND active = 1',
        args: [item.productId, saleId],
      })
    ).rows[0];
    if (!p) throw new Error('商品が見つかりません');
    let variantLabel = '';
    if (item.variantId != null) {
      const v = (
        await tx.execute({
          sql: 'SELECT * FROM kiosk_product_variants WHERE id = ? AND product_id = ?',
          args: [item.variantId, item.productId],
        })
      ).rows[0];
      if (!v) throw new Error('サイズが見つかりません');
      variantLabel = String(v.label);
    }
    resolved.push({
      productId: item.productId,
      variantId: item.variantId ?? null,
      productName: String(p.name),
      variantLabel,
      unitPrice: Number(p.price),
      qty: item.qty,
    });
  }
  return resolved;
}

/** トランザクション内で在庫(pending仮押さえ込みの販売可能数)を確認する。 */
async function assertAvailable(tx: Transaction, saleId: number, resolved: ResolvedItem[]): Promise<void> {
  const holdsRes = await tx.execute({ sql: PENDING_HOLDS_SQL, args: [saleId] });
  const holds = aggregateHolds(holdsRes.rows as unknown as PendingRow[]);
  // 同一注文内の同じ商品/サイズの重複行も合算して判定する
  const wantedByProduct = new Map<number, number>();
  const wantedByVariant = new Map<number, number>();
  for (const r of resolved) {
    if (r.variantId != null) wantedByVariant.set(r.variantId, (wantedByVariant.get(r.variantId) ?? 0) + r.qty);
    else wantedByProduct.set(r.productId, (wantedByProduct.get(r.productId) ?? 0) + r.qty);
  }
  for (const [variantId, wanted] of wantedByVariant) {
    const v = (await tx.execute({ sql: 'SELECT stock, label FROM kiosk_product_variants WHERE id = ?', args: [variantId] })).rows[0];
    const available = Number(v?.stock ?? 0) - (holds.byVariant.get(variantId) ?? 0);
    if (wanted > available) throw new Error(`申し訳ありません。${String(v?.label ?? '')}サイズの在庫が足りません(残り${Math.max(0, available)}点)`);
  }
  for (const [productId, wanted] of wantedByProduct) {
    const p = (await tx.execute({ sql: 'SELECT stock, name FROM kiosk_products WHERE id = ?', args: [productId] })).rows[0];
    const available = Number(p?.stock ?? 0) - (holds.byProduct.get(productId) ?? 0);
    if (wanted > available) throw new Error(`申し訳ありません。${String(p?.name ?? '')}の在庫が足りません(残り${Math.max(0, available)}点)`);
  }
}

async function insertOrder(
  tx: Transaction,
  saleId: number,
  paymentMethod: 'stripe' | 'cash',
  status: 'pending' | 'paid',
  expiresAt: string,
  resolved: ResolvedItem[]
): Promise<{ orderId: number; amountTotal: number }> {
  const amountTotal = resolved.reduce((s, r) => s + r.unitPrice * r.qty, 0);
  const now = nowIso();
  const orderRes = await tx.execute({
    sql: 'INSERT INTO kiosk_orders (sale_id, payment_method, status, amount_total, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [saleId, paymentMethod, status, amountTotal, expiresAt, now, now],
  });
  const orderId = Number(orderRes.lastInsertRowid);
  for (const r of resolved) {
    await tx.execute({
      sql: 'INSERT INTO kiosk_order_items (order_id, product_id, variant_id, product_name, variant_label, unit_price, qty) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [orderId, r.productId, r.variantId, r.productName, r.variantLabel, r.unitPrice, r.qty],
    });
  }
  return { orderId, amountTotal };
}

/** 実在庫を減らす(決済確定時のみ)。マイナスは許容し、スタッフ画面の警告で拾う。 */
async function decrementStock(tx: Transaction, orderId: number): Promise<void> {
  const items = (await tx.execute({ sql: 'SELECT product_id, variant_id, qty FROM kiosk_order_items WHERE order_id = ?', args: [orderId] }))
    .rows as unknown as PendingRow[];
  for (const it of items) {
    if (it.variant_id != null) {
      await tx.execute({ sql: 'UPDATE kiosk_product_variants SET stock = stock - ? WHERE id = ?', args: [Number(it.qty), Number(it.variant_id)] });
    } else {
      await tx.execute({ sql: 'UPDATE kiosk_products SET stock = stock - ? WHERE id = ?', args: [Number(it.qty), Number(it.product_id)] });
    }
  }
}

async function restoreStock(tx: Transaction, orderId: number): Promise<void> {
  const items = (await tx.execute({ sql: 'SELECT product_id, variant_id, qty FROM kiosk_order_items WHERE order_id = ?', args: [orderId] }))
    .rows as unknown as PendingRow[];
  for (const it of items) {
    if (it.variant_id != null) {
      await tx.execute({ sql: 'UPDATE kiosk_product_variants SET stock = stock + ? WHERE id = ?', args: [Number(it.qty), Number(it.variant_id)] });
    } else {
      await tx.execute({ sql: 'UPDATE kiosk_products SET stock = stock + ? WHERE id = ?', args: [Number(it.qty), Number(it.product_id)] });
    }
  }
}

// ---------------------------------------------------------------------------
// Stripe注文(pending仮押さえ → Webhookでpaid化)
// ---------------------------------------------------------------------------

export async function createKioskStripeOrder(items: KioskCartItem[]): Promise<CreateKioskOrderResult> {
  await initDb();
  await sweepExpiredKioskOrders();
  const sale = await getActiveKioskSale();
  if (!sale) return { ok: false, error: '現在販売中の商品がありません' };
  const expiresAt = new Date(Date.now() + KIOSK_HOLD_MINUTES * 60 * 1000).toISOString();
  try {
    const result = await withWriteTx(async (tx) => {
      const resolved = await resolveItems(tx, sale.id, items);
      await assertAvailable(tx, sale.id, resolved);
      return insertOrder(tx, sale.id, 'stripe', 'pending', expiresAt, resolved);
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '注文の作成に失敗しました' };
  }
}

export async function attachKioskStripeSession(orderId: number, sessionId: string): Promise<void> {
  await execute('UPDATE kiosk_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?', [sessionId, nowIso(), orderId]);
}

/** QRやめる/タイムアウトのリセット。pendingのみexpired化(在庫仮押さえの解放)。 */
export async function cancelKioskOrder(orderId: number): Promise<boolean> {
  await initDb();
  const res = await execute("UPDATE kiosk_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'", [
    nowIso(),
    orderId,
  ]);
  return Number(res.rowsAffected ?? 0) > 0;
}

export async function getKioskOrderStatus(orderId: number): Promise<string | null> {
  await initDb();
  const row = await getOne('SELECT status FROM kiosk_orders WHERE id = ?', [orderId]);
  return row ? String(row.status) : null;
}

export async function getKioskOrderSessionId(orderId: number): Promise<string> {
  const row = await getOne('SELECT stripe_session_id FROM kiosk_orders WHERE id = ?', [orderId]);
  return String(row?.stripe_session_id ?? '');
}

// ---------------------------------------------------------------------------
// 現金注文(即確定)
// ---------------------------------------------------------------------------

export async function createKioskCashOrder(items: KioskCartItem[]): Promise<CreateKioskOrderResult> {
  await initDb();
  await sweepExpiredKioskOrders();
  const sale = await getActiveKioskSale();
  if (!sale) return { ok: false, error: '現在販売中の商品がありません' };
  try {
    const result = await withWriteTx(async (tx) => {
      const resolved = await resolveItems(tx, sale.id, items);
      await assertAvailable(tx, sale.id, resolved);
      const inserted = await insertOrder(tx, sale.id, 'cash', 'paid', '', resolved);
      await decrementStock(tx, inserted.orderId);
      return inserted;
    });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '注文の作成に失敗しました' };
  }
}

/** スタッフによる取消(現金の誤タップ・返金対応)。paidのみ・在庫を戻す。 */
export async function voidKioskOrder(orderId: number, reason: string): Promise<boolean> {
  await initDb();
  try {
    return await withWriteTx(async (tx) => {
      const res = await tx.execute({
        sql: "UPDATE kiosk_orders SET status = 'voided', void_reason = ?, updated_at = ? WHERE id = ? AND status = 'paid'",
        args: [reason, nowIso(), orderId],
      });
      if (Number(res.rowsAffected ?? 0) === 0) return false;
      await restoreStock(tx, orderId);
      return true;
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// スタッフ画面用: 一覧・レポート・在庫補正
// ---------------------------------------------------------------------------

export async function listKioskSales(): Promise<Array<KioskSale & { createdAt: string }>> {
  await initDb();
  const rows = await getAll('SELECT * FROM kiosk_sales ORDER BY id DESC');
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    eventDate: String(r.event_date ?? ''),
    active: Number(r.active) === 1,
    createdAt: String(r.created_at ?? ''),
  }));
}

export async function updateKioskProduct(
  id: number,
  p: { name: string; price: number; imageUrl: string; description: string; sortOrder: number; active: boolean }
): Promise<void> {
  await execute(
    'UPDATE kiosk_products SET name = ?, price = ?, image_url = ?, description = ?, sort_order = ?, active = ? WHERE id = ?',
    [p.name, p.price, p.imageUrl, p.description, p.sortOrder, p.active ? 1 : 0, id]
  );
}

/** 在庫補正(絶対値で上書き。±指定より数え直しと相性が良い)。 */
export async function setKioskProductStock(productId: number, stock: number): Promise<void> {
  await execute('UPDATE kiosk_products SET stock = ? WHERE id = ?', [stock, productId]);
}

export async function setKioskVariantStock(variantId: number, stock: number): Promise<void> {
  await execute('UPDATE kiosk_product_variants SET stock = ? WHERE id = ?', [stock, variantId]);
}

export async function deleteKioskVariant(variantId: number): Promise<void> {
  await execute('DELETE FROM kiosk_product_variants WHERE id = ?', [variantId]);
}

export interface KioskOrderItemView {
  productName: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
}

export interface KioskOrderView {
  orderId: number;
  paymentMethod: string;
  status: string;
  amountTotal: number;
  amountMismatch: boolean;
  paidAfterExpired: boolean;
  voidReason: string;
  createdAt: string;
  items: KioskOrderItemView[];
}

export interface KioskSalesReport {
  totals: { total: number; cash: number; stripe: number; orderCount: number };
  byProduct: Array<{ productName: string; variantLabel: string; qty: number; amount: number }>;
  orders: KioskOrderView[];
}

/**
 * 販売会の売上レポート。金額は明細の単価スナップショット×数量で集計する
 * (商品マスタの現在価格は使わない=P4教訓)。paidのみ計上・voidedは一覧にだけ出す。
 */
export async function getKioskSalesReport(saleId: number): Promise<KioskSalesReport> {
  await initDb();
  await sweepExpiredKioskOrders();
  const orderRows = await getAll(
    "SELECT * FROM kiosk_orders WHERE sale_id = ? AND status != 'expired' ORDER BY id DESC",
    [saleId]
  );
  const itemRows = await getAll(
    'SELECT i.* FROM kiosk_order_items i JOIN kiosk_orders o ON o.id = i.order_id WHERE o.sale_id = ?',
    [saleId]
  );
  const itemsByOrder = new Map<number, KioskOrderItemView[]>();
  for (const r of itemRows) {
    const list = itemsByOrder.get(Number(r.order_id)) ?? [];
    list.push({
      productName: String(r.product_name),
      variantLabel: String(r.variant_label ?? ''),
      unitPrice: Number(r.unit_price),
      qty: Number(r.qty),
    });
    itemsByOrder.set(Number(r.order_id), list);
  }

  const orders: KioskOrderView[] = orderRows.map((o) => ({
    orderId: Number(o.id),
    paymentMethod: String(o.payment_method),
    status: String(o.status),
    amountTotal: Number(o.amount_total),
    amountMismatch: Number(o.amount_mismatch) === 1,
    paidAfterExpired: Number(o.paid_after_expired) === 1,
    voidReason: String(o.void_reason ?? ''),
    createdAt: String(o.created_at ?? ''),
    items: itemsByOrder.get(Number(o.id)) ?? [],
  }));

  const paid = orders.filter((o) => o.status === 'paid');
  const totals = {
    total: paid.reduce((s, o) => s + o.amountTotal, 0),
    cash: paid.filter((o) => o.paymentMethod === 'cash').reduce((s, o) => s + o.amountTotal, 0),
    stripe: paid.filter((o) => o.paymentMethod === 'stripe').reduce((s, o) => s + o.amountTotal, 0),
    orderCount: paid.length,
  };

  const byProductMap = new Map<string, { productName: string; variantLabel: string; qty: number; amount: number }>();
  for (const o of paid) {
    for (const it of o.items) {
      const key = `${it.productName} ${it.variantLabel}`;
      const cur = byProductMap.get(key) ?? { productName: it.productName, variantLabel: it.variantLabel, qty: 0, amount: 0 };
      cur.qty += it.qty;
      cur.amount += it.unitPrice * it.qty;
      byProductMap.set(key, cur);
    }
  }
  const byProduct = [...byProductMap.values()].sort((a, b) => b.amount - a.amount);

  return { totals, byProduct, orders };
}

// ---------------------------------------------------------------------------
// Webhook適用(決済の正本・冪等)
// ---------------------------------------------------------------------------

export interface KioskWebhookEventInput {
  eventId: string;
  type: string;
  sessionId: string;
  orderId: number | null;
  amountTotal: number | null;
  /** Checkout Sessionの payment_status。非同期決済(PayPay等)の処理中は 'unpaid'。 */
  paymentStatus?: string;
}

export type ApplyKioskWebhookResult =
  | { status: 'paid'; orderId: number; amountMismatch: boolean }
  | { status: 'duplicate' | 'ignored' | 'order_not_found' | 'not_updated' | 'async_pending' | 'payment_failed' };

/** 非同期決済の処理中に仮押さえを延長する時間。 */
const ASYNC_HOLD_EXTENSION_MINUTES = 30;

/**
 * 検証済みWebhookイベントを適用する。
 * - kiosk_payments に stripe_event_id UNIQUE で記録=同一イベント再送は何もしない(冪等)
 * - checkout.session.completed (payment_status=paid) / async_payment_succeeded で
 *   pending/expired → paid + 実在庫減
 * - completed でも payment_status=unpaid(非同期決済の処理中)は paid 化せず、
 *   仮押さえを延長して async_payment_succeeded/failed を待つ
 * - 期限切れ後の入金は paid_after_expired=1(在庫マイナスの可能性をスタッフ画面で警告)
 * - 金額不一致でも paid にする(入金事実を優先)が amount_mismatch=1 を立てる
 */
export async function applyKioskWebhookEvent(ev: KioskWebhookEventInput, rawPayload: string): Promise<ApplyKioskWebhookResult> {
  await initDb();
  const inserted = await execute(
    'INSERT OR IGNORE INTO kiosk_payments (stripe_event_id, event_type, stripe_session_id, order_id, amount, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [ev.eventId, ev.type, ev.sessionId, ev.orderId, ev.amountTotal ?? 0, rawPayload.slice(0, 20000), nowIso()]
  );
  if (Number(inserted.rowsAffected ?? 0) === 0) return { status: 'duplicate' };
  const KNOWN_TYPES = [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
  ];
  if (!KNOWN_TYPES.includes(ev.type)) return { status: 'ignored' };

  const row = ev.orderId != null
    ? await getOne('SELECT * FROM kiosk_orders WHERE id = ? LIMIT 1', [ev.orderId])
    : await getOne('SELECT * FROM kiosk_orders WHERE stripe_session_id = ? AND stripe_session_id != ? LIMIT 1', [ev.sessionId, '']);
  if (!row) return { status: 'order_not_found' };
  const orderId = Number(row.id);
  const wasExpired = String(row.status) === 'expired';

  if (ev.type === 'checkout.session.async_payment_failed') {
    // 非同期決済の失敗=入金なし。仮押さえを解放する(paid済みには作用しない)
    await execute("UPDATE kiosk_orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'", [
      nowIso(),
      orderId,
    ]);
    return { status: 'payment_failed' };
  }

  if (ev.type === 'checkout.session.completed' && ev.paymentStatus === 'unpaid') {
    // 非同期決済の処理中。入金確定は async_payment_succeeded で来るので、
    // それまで仮押さえが切れないよう延長だけしておく
    const extendedTo = new Date(Date.now() + ASYNC_HOLD_EXTENSION_MINUTES * 60 * 1000).toISOString();
    await execute(
      "UPDATE kiosk_orders SET expires_at = ?, stripe_session_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
      [extendedTo, ev.sessionId, nowIso(), orderId]
    );
    return { status: 'async_pending' };
  }

  try {
    const applied = await withWriteTx(async (tx) => {
      const updated = await tx.execute({
        sql: "UPDATE kiosk_orders SET status = 'paid', stripe_session_id = ?, paid_after_expired = ?, amount_mismatch = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'expired')",
        args: [
          ev.sessionId,
          wasExpired ? 1 : 0,
          ev.amountTotal != null && ev.amountTotal !== Number(row.amount_total) ? 1 : 0,
          nowIso(),
          orderId,
        ],
      });
      if (Number(updated.rowsAffected ?? 0) === 0) return false;
      await decrementStock(tx, orderId);
      return true;
    });
    if (!applied) return { status: 'not_updated' };
  } catch (e) {
    // 500でStripeに再送させると kiosk_payments 済みのため duplicate になり在庫減が失われる。
    // ここまで来たら注文は特定済みなので、失敗はログに残して手動確認に倒す。
    console.error('[kiosk] webhook apply failed for order', orderId, e instanceof Error ? e.message : e);
    return { status: 'not_updated' };
  }
  return {
    status: 'paid',
    orderId,
    amountMismatch: ev.amountTotal != null && ev.amountTotal !== Number(row.amount_total),
  };
}
