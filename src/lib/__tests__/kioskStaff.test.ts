// kiosk スタッフ画面用の集計・CSV。売上レポートは「お金の答え合わせ」に使うため、
// paidのみ計上・void/pending除外・単価スナップショット基準を実DBで確かめる。
import { describe, it, expect, beforeAll } from 'vitest';
import { rmSync } from 'node:fs';

const TEST_DB = './data/test_kiosk_staff.db';
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

describe('売上レポート', () => {
  it('paidのみ計上・決済方法別・商品別(スナップショット名)で集計される', async () => {
    const saleId = await k.createKioskSale('レポート販売会', '2026-09-26');
    await k.setActiveKioskSale(saleId);
    const tee = await k.addKioskProduct(saleId, { name: 'Tシャツ', price: 3500, stock: 0 });
    const vM = await k.addKioskVariant(tee, 'M', 10);
    const sticker = await k.addKioskProduct(saleId, { name: 'ステッカー', price: 500, stock: 30 });

    // 現金でTシャツM×2
    const cash = await k.createKioskCashOrder([{ productId: tee, variantId: vM, qty: 2 }]);
    if (!cash.ok) throw new Error('setup');
    // StripeでステッカーX1(paid化)
    const stripe = await k.createKioskStripeOrder([{ productId: sticker, variantId: null, qty: 1 }]);
    if (!stripe.ok) throw new Error('setup');
    await k.applyKioskWebhookEvent(
      { eventId: 'evt_rep_1', type: 'checkout.session.completed', sessionId: 'cs_rep_1', orderId: stripe.orderId, amountTotal: 500, paymentStatus: 'paid' },
      '{}'
    );
    // 取消した現金注文(計上されない)
    const voided = await k.createKioskCashOrder([{ productId: sticker, variantId: null, qty: 3 }]);
    if (!voided.ok) throw new Error('setup');
    await k.voidKioskOrder(voided.orderId, 'テスト取消');
    // pendingのまま(計上されない)
    await k.createKioskStripeOrder([{ productId: sticker, variantId: null, qty: 5 }]);

    const rep = await k.getKioskSalesReport(saleId);
    expect(rep.totals.total).toBe(7500);
    expect(rep.totals.cash).toBe(7000);
    expect(rep.totals.stripe).toBe(500);
    expect(rep.totals.orderCount).toBe(2);
    const teeRow = rep.byProduct.find((r) => r.productName === 'Tシャツ' && r.variantLabel === 'M');
    expect(teeRow?.qty).toBe(2);
    expect(teeRow?.amount).toBe(7000);
    // 注文一覧にはvoidedも出る(取消の追跡用)がpendingの表示用statusも持つ
    expect(rep.orders.some((o) => o.status === 'voided')).toBe(true);
  });
});

describe('CSV出力', () => {
  it('明細行がカンマ区切りで出る(名前にカンマがあっても壊れない)', async () => {
    const { buildKioskOrdersCsv } = await import('../kioskCsv');
    const csv = buildKioskOrdersCsv([
      {
        orderId: 1,
        createdAt: '2026-09-26T05:00:00.000Z',
        paymentMethod: 'cash',
        status: 'paid',
        productName: 'Tシャツ,限定',
        variantLabel: 'M',
        unitPrice: 3500,
        qty: 2,
        lineAmount: 7000,
      },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('注文番号');
    expect(lines[1]).toContain('"Tシャツ,限定"');
    expect(lines[1]).toContain('7000');
    expect(lines[1]).toContain('現金');
  });
});

describe('在庫補正', () => {
  it('商品在庫とサイズ在庫を絶対値で上書きできる', async () => {
    const saleId = await k.createKioskSale('補正販売会', '2026-09-26');
    const p = await k.addKioskProduct(saleId, { name: '補正商品', price: 100, stock: 5 });
    const v = await k.addKioskVariant(p, 'F', 5);
    await k.setKioskProductStock(p, 9);
    await k.setKioskVariantStock(v, 1);
    const row = await core.getOne('SELECT stock FROM kiosk_products WHERE id = ?', [p]);
    const vrow = await core.getOne('SELECT stock FROM kiosk_product_variants WHERE id = ?', [v]);
    expect(Number(row?.stock)).toBe(9);
    expect(Number(vrow?.stock)).toBe(1);
  });
});
