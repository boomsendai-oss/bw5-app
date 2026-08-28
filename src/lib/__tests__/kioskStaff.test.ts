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

describe('販売会の編集', () => {
  it('名前と開催日をスタッフが変更できる', async () => {
    const id = await k.createKioskSale('旧名', '2026-09-26');
    await k.updateKioskSale(id, 'BOOMER FIGHT物販', '2026-09-27');
    const row = await core.getOne('SELECT name, event_date FROM kiosk_sales WHERE id = ?', [id]);
    expect(String(row?.name)).toBe('BOOMER FIGHT物販');
    expect(String(row?.event_date)).toBe('2026-09-27');
  });
});

describe('バリエーションのカラー/サイズ', () => {
  it('カラーとサイズを分けて登録でき、カタログにも両方返る(labelは表示用合成)', async () => {
    const saleId = await k.createKioskSale('CS販売会', '2026-09-26');
    const p = await k.addKioskProduct(saleId, { name: 'CS商品', price: 1000, stock: 0 });
    await k.addKioskVariantCS(p, { color: 'ホワイト', size: 'M', stock: 3 });
    await k.addKioskVariantCS(p, { color: '', size: 'F', stock: 2 });
    const catalog = await k.getKioskCatalog(saleId);
    const vs = catalog[0].variants;
    expect(vs[0].color).toBe('ホワイト');
    expect(vs[0].size).toBe('M');
    expect(vs[0].label).toBe('ホワイト M');
    expect(vs[1].label).toBe('F');
  });
});

describe('BASE取り込み', () => {
  const mapped = {
    name: 'BASEシャツ',
    price: 5800,
    imageUrl: 'https://base-ec2.akamaized.net/x.png',
    stock: 0,
    variants: [
      { color: 'ブラック', size: 'S', stock: 1 },
      { color: 'ブラック', size: 'M', stock: 2 },
    ],
  };

  it('新規取り込みで商品+バリエーションが作られ、base_item_idが記録される', async () => {
    const saleId = await k.createKioskSale('BASE販売会', '2026-09-26');
    const res = await k.importBaseProductToSale(saleId, 999111, mapped);
    expect(res.created).toBe(true);
    const catalog = await k.getKioskCatalog(saleId);
    expect(catalog[0].name).toBe('BASEシャツ');
    expect(catalog[0].variants).toHaveLength(2);
    const row = await core.getOne('SELECT base_item_id FROM kiosk_products WHERE id = ?', [catalog[0].id]);
    expect(Number(row?.base_item_id)).toBe(999111);
  });

  it('同じbase_item_idの再取り込みは複製せず価格と在庫を上書きし、新サイズは追加される', async () => {
    const saleId = await k.createKioskSale('BASE販売会2', '2026-09-26');
    await k.importBaseProductToSale(saleId, 999222, mapped);
    const updated = {
      ...mapped,
      price: 6000,
      variants: [
        { color: 'ブラック', size: 'S', stock: 5 },
        { color: 'ブラック', size: 'M', stock: 0 },
        { color: 'ブルー', size: 'L', stock: 3 },
      ],
    };
    const res = await k.importBaseProductToSale(saleId, 999222, updated);
    expect(res.created).toBe(false);
    const catalog = await k.getKioskCatalog(saleId);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].price).toBe(6000);
    const vs = catalog[0].variants;
    expect(vs).toHaveLength(3);
    expect(vs.find((v) => v.label === 'ブラック S')?.stock).toBe(5);
    expect(vs.find((v) => v.label === 'ブラック M')?.stock).toBe(0);
    expect(vs.find((v) => v.label === 'ブルー L')?.stock).toBe(3);
  });
});

describe('BASE在庫反映(売上の抽出とフラグ)', () => {
  it('paid+base_item_idあり+未同期の明細だけが抽出され、markで同期済みになる', async () => {
    const saleId = await k.createKioskSale('同期販売会', '2026-09-26');
    await k.setActiveKioskSale(saleId);
    const imp = await k.importBaseProductToSale(saleId, 888001, {
      name: '同期シャツ', price: 1000, imageUrl: '', stock: 0,
      variants: [{ color: 'ブラック', size: 'S', stock: 10 }],
    });
    const manual = await k.addKioskProduct(saleId, { name: '手動商品', price: 500, stock: 10 });
    const catalog = await k.getKioskCatalog(saleId);
    const vId = catalog.find((p) => p.id === imp.productId)!.variants[0].id;

    const o1 = await k.createKioskCashOrder([{ productId: imp.productId, variantId: vId, qty: 2 }]);
    const o2 = await k.createKioskCashOrder([{ productId: manual, variantId: null, qty: 1 }]);
    if (!o1.ok || !o2.ok) throw new Error('setup');
    // 取消済みは含まれない
    const o3 = await k.createKioskCashOrder([{ productId: imp.productId, variantId: vId, qty: 1 }]);
    if (!o3.ok) throw new Error('setup');
    await k.voidKioskOrder(o3.orderId, 'test');

    const unsynced = await k.getUnsyncedBaseSales(saleId);
    expect(unsynced.lines).toEqual([{ baseItemId: 888001, variantLabel: 'ブラック S', qty: 2 }]);
    expect(unsynced.orderIds).toEqual([o1.orderId]);

    await k.markKioskOrdersBaseSynced(unsynced.orderIds);
    const after = await k.getUnsyncedBaseSales(saleId);
    expect(after.lines).toEqual([]);
  });
});
