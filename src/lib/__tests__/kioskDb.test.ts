// 無人物販kiosk の DB 層テスト(実DB)。
// お金と在庫が絡む中核: 仮押さえ(pending)と実在庫減算のタイミング、Webhook冪等化、
// 期限切れ後入金の回収、現金注文の取消を実DBで確かめる。
// 一時ファイルDBを使う。db.ts は最初の接続時に TURSO_DATABASE_URL を読むため import より先に設定する。
import { describe, it, expect, beforeAll } from 'vitest';
import { rmSync } from 'node:fs';

const TEST_DB = './data/test_kiosk.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

type DbMod = typeof import('../kioskDb');
type Core = typeof import('../db');
let k: DbMod;
let core: Core;

beforeAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(TEST_DB + suffix);
    } catch {
      /* 初回は存在しない */
    }
  }
  core = await import('../db');
  k = await import('../kioskDb');
  await core.initDb();
});

/** 販売会+商品を1セット作るヘルパ。 */
async function setupSale(opts?: { stock?: number; price?: number }) {
  const saleId = await k.createKioskSale('テスト販売会', '2026-09-26');
  await k.setActiveKioskSale(saleId);
  const productId = await k.addKioskProduct(saleId, {
    name: '黒×黒Tシャツ',
    price: opts?.price ?? 3500,
    stock: opts?.stock ?? 10,
  });
  return { saleId, productId };
}

async function stockOf(productId: number): Promise<number> {
  const row = await core.getOne('SELECT stock FROM kiosk_products WHERE id = ?', [productId]);
  return Number(row?.stock);
}

describe('販売会', () => {
  it('activeにできる販売会は同時に1つ(切替で他が下りる)', async () => {
    const a = await k.createKioskSale('販売会A', '2026-09-26');
    const b = await k.createKioskSale('販売会B', '2026-10-10');
    await k.setActiveKioskSale(a);
    await k.setActiveKioskSale(b);
    const active = await k.getActiveKioskSale();
    expect(active?.id).toBe(b);
    const rowA = await core.getOne('SELECT active FROM kiosk_sales WHERE id = ?', [a]);
    expect(Number(rowA?.active)).toBe(0);
  });
});

describe('Stripe注文(仮押さえ)', () => {
  it('注文作成で金額はDB価格から再計算され、明細に単価スナップショットが残る', async () => {
    const { productId } = await setupSale({ price: 3500 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 2 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.amountTotal).toBe(7000);
    const item = await core.getOne('SELECT * FROM kiosk_order_items WHERE order_id = ?', [res.orderId]);
    expect(Number(item?.unit_price)).toBe(3500);
    expect(String(item?.product_name)).toBe('黒×黒Tシャツ');
  });

  it('pendingの仮押さえ分だけ販売可能数が減る(実在庫はまだ減らない)', async () => {
    const { saleId, productId } = await setupSale({ stock: 5 });
    await k.createKioskStripeOrder([{ productId, variantId: null, qty: 3 }]);
    expect(await stockOf(productId)).toBe(5);
    const catalog = await k.getKioskCatalog(saleId);
    expect(catalog[0].available).toBe(2);
  });

  it('販売可能数を超える注文は断られる', async () => {
    const { productId } = await setupSale({ stock: 2 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 3 }]);
    expect(res.ok).toBe(false);
  });

  it('1注文の合計数量が上限を超えると断られる', async () => {
    const { productId } = await setupSale({ stock: 100 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 11 }]);
    expect(res.ok).toBe(false);
  });

  it('期限切れpendingはsweepでexpired化され仮押さえが解放される', async () => {
    const { saleId, productId } = await setupSale({ stock: 5 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 3 }]);
    if (!res.ok) throw new Error('setup failed');
    await core.execute("UPDATE kiosk_orders SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?", [res.orderId]);
    await k.sweepExpiredKioskOrders();
    const catalog = await k.getKioskCatalog(saleId);
    expect(catalog[0].available).toBe(5);
    expect(await k.getKioskOrderStatus(res.orderId)).toBe('expired');
  });

  it('キャンセル(QRやめる/リセット)でpendingがexpired化される', async () => {
    const { productId } = await setupSale();
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 1 }]);
    if (!res.ok) throw new Error('setup failed');
    expect(await k.cancelKioskOrder(res.orderId)).toBe(true);
    expect(await k.getKioskOrderStatus(res.orderId)).toBe('expired');
  });
});

describe('バリエーション(サイズ)', () => {
  it('バリエーションあり商品は在庫がvariant単位で管理される', async () => {
    const { saleId, productId } = await setupSale({ stock: 0 });
    const vM = await k.addKioskVariant(productId, 'M', 3);
    await k.addKioskVariant(productId, 'L', 2);
    const res = await k.createKioskStripeOrder([{ productId, variantId: vM, qty: 2 }]);
    expect(res.ok).toBe(true);
    const catalog = await k.getKioskCatalog(saleId);
    const variants = catalog[0].variants;
    expect(variants.find((v) => v.label === 'M')?.available).toBe(1);
    expect(variants.find((v) => v.label === 'L')?.available).toBe(2);
  });

  it('variant在庫を超える注文は断られる', async () => {
    const { productId } = await setupSale({ stock: 0 });
    const vM = await k.addKioskVariant(productId, 'M', 1);
    const res = await k.createKioskStripeOrder([{ productId, variantId: vM, qty: 2 }]);
    expect(res.ok).toBe(false);
  });
});

describe('Webhook適用(決済の正本)', () => {
  const ev = (orderId: number, eventId: string, amount: number) => ({
    eventId,
    type: 'checkout.session.completed',
    sessionId: `cs_test_${eventId}`,
    orderId,
    amountTotal: amount,
  });

  it('checkout.session.completed で paid 化し実在庫が減る', async () => {
    const { productId } = await setupSale({ stock: 5 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 2 }]);
    if (!res.ok) throw new Error('setup failed');
    const result = await k.applyKioskWebhookEvent(ev(res.orderId, 'evt_paid_1', 7000), '{}');
    expect(result.status).toBe('paid');
    expect(await k.getKioskOrderStatus(res.orderId)).toBe('paid');
    expect(await stockOf(productId)).toBe(3);
  });

  it('同じイベントIDの再送は duplicate として何もしない(在庫を二重に減らさない)', async () => {
    const { productId } = await setupSale({ stock: 5 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 2 }]);
    if (!res.ok) throw new Error('setup failed');
    await k.applyKioskWebhookEvent(ev(res.orderId, 'evt_dup_1', 7000), '{}');
    const second = await k.applyKioskWebhookEvent(ev(res.orderId, 'evt_dup_1', 7000), '{}');
    expect(second.status).toBe('duplicate');
    expect(await stockOf(productId)).toBe(3);
  });

  it('期限切れ後の入金も paid に戻し(入金事実を優先)、paid_after_expired フラグが立つ', async () => {
    const { productId } = await setupSale({ stock: 5 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 1 }]);
    if (!res.ok) throw new Error('setup failed');
    await k.cancelKioskOrder(res.orderId);
    const result = await k.applyKioskWebhookEvent(ev(res.orderId, 'evt_late_1', 3500), '{}');
    expect(result.status).toBe('paid');
    const row = await core.getOne('SELECT status, paid_after_expired FROM kiosk_orders WHERE id = ?', [res.orderId]);
    expect(String(row?.status)).toBe('paid');
    expect(Number(row?.paid_after_expired)).toBe(1);
    expect(await stockOf(productId)).toBe(4);
  });

  it('金額不一致でも paid にするが amount_mismatch フラグが立つ', async () => {
    const { productId } = await setupSale({ stock: 5 });
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 1 }]);
    if (!res.ok) throw new Error('setup failed');
    await k.applyKioskWebhookEvent(ev(res.orderId, 'evt_mismatch_1', 100), '{}');
    const row = await core.getOne('SELECT amount_mismatch FROM kiosk_orders WHERE id = ?', [res.orderId]);
    expect(Number(row?.amount_mismatch)).toBe(1);
  });

  it('kiosk向けでないイベント(orderIdなし)は ignored', async () => {
    const result = await k.applyKioskWebhookEvent(
      { eventId: 'evt_other_1', type: 'checkout.session.completed', sessionId: 'cs_bf6_1', orderId: null, amountTotal: 1000 },
      '{}'
    );
    expect(result.status).toBe('order_not_found');
  });
});

describe('現金注文', () => {
  it('現金ボタンで即 paid + 実在庫減', async () => {
    const { productId } = await setupSale({ stock: 5 });
    const res = await k.createKioskCashOrder([{ productId, variantId: null, qty: 2 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await k.getKioskOrderStatus(res.orderId)).toBe('paid');
    expect(await stockOf(productId)).toBe(3);
  });

  it('在庫不足の現金注文は断られる', async () => {
    const { productId } = await setupSale({ stock: 1 });
    const res = await k.createKioskCashOrder([{ productId, variantId: null, qty: 2 }]);
    expect(res.ok).toBe(false);
  });

  it('スタッフ取消(void)で在庫が戻る', async () => {
    const { productId } = await setupSale({ stock: 5 });
    const res = await k.createKioskCashOrder([{ productId, variantId: null, qty: 2 }]);
    if (!res.ok) throw new Error('setup failed');
    expect(await k.voidKioskOrder(res.orderId, '誤タップ')).toBe(true);
    expect(await k.getKioskOrderStatus(res.orderId)).toBe('voided');
    expect(await stockOf(productId)).toBe(5);
  });

  it('pendingの注文はvoidできない(取消はpaidのみ)', async () => {
    const { productId } = await setupSale();
    const res = await k.createKioskStripeOrder([{ productId, variantId: null, qty: 1 }]);
    if (!res.ok) throw new Error('setup failed');
    expect(await k.voidKioskOrder(res.orderId, 'test')).toBe(false);
  });
});
