// Tシャツ注文の DB 層の結合テスト。
// 「トークン一致の1件しか読めない」「郵送しない注文には住所が残らない」を実DBで確かめる
// (ここを取り違えると、名簿の列挙や不要なPII保持につながる)。
//
// 一時ファイルDBを使う。db.ts は最初の接続時に TURSO_DATABASE_URL を読むため import より先に設定する。
import { describe, it, expect, beforeAll } from 'vitest';
import { rmSync } from 'node:fs';

const TEST_DB = './data/test_tshirt_order.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

type DbMod = typeof import('../tshirtOrderDb');
let db: DbMod;

const pickup = { name: 'キムラ', size: 'L' as const, qty: 2, wantsShipping: false, address: '', phone: '' };
const shipped = {
  name: 'サトウ', size: 'S' as const, qty: 1, wantsShipping: true,
  address: '仙台市青葉区1-1', phone: '090-1234-5678',
};

beforeAll(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(TEST_DB + suffix);
    } catch {
      /* 初回は存在しない */
    }
  }
  db = await import('../tshirtOrderDb');
});

describe('createOrder / loadOrderByToken', () => {
  it('作った注文をトークンで1件だけ読める', async () => {
    const token = await db.createOrder(pickup);
    const got = await db.loadOrderByToken(token);
    expect(got).not.toBeNull();
    expect(got!.name).toBe('キムラ');
    expect(got!.size).toBe('L');
    expect(got!.qty).toBe(2);
    expect(got!.totalAmount).toBe(7000);
  });

  it('郵送希望の注文は住所・電話と送料込み合計が保存される', async () => {
    const token = await db.createOrder(shipped);
    const got = await db.loadOrderByToken(token);
    expect(got!.wantsShipping).toBe(true);
    expect(got!.address).toBe('仙台市青葉区1-1');
    expect(got!.totalAmount).toBe(4300);
  });

  it('郵送しない注文は住所・電話が空で保存される（PIIを持たない）', async () => {
    const token = await db.createOrder(pickup);
    const got = await db.loadOrderByToken(token);
    expect(got!.address).toBe('');
    expect(got!.phone).toBe('');
  });

  it('存在しないトークンでは null（他人の注文は読めない）', async () => {
    expect(await db.loadOrderByToken('0'.repeat(48))).toBeNull();
    expect(await db.loadOrderByToken('')).toBeNull();
  });
});

describe('updateOrderByToken', () => {
  it('自分のトークンなら枚数を変更でき、合計金額も再計算される', async () => {
    const token = await db.createOrder(pickup);
    const ok = await db.updateOrderByToken(token, { ...pickup, qty: 3 });
    expect(ok).toBe(true);
    const got = await db.loadOrderByToken(token);
    expect(got!.qty).toBe(3);
    expect(got!.totalAmount).toBe(10500);
  });

  it('存在しないトークンでは false', async () => {
    expect(await db.updateOrderByToken('f'.repeat(48), pickup)).toBe(false);
  });
});

describe('listOrders（スタッフ用）', () => {
  it('注文を全件返す', async () => {
    const rows = await db.listOrders();
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => typeof r.id === 'number')).toBe(true);
  });
});

describe('設定', () => {
  it('未保存ならデフォルト設定を返す', async () => {
    const s = await db.resolveTshirtSettings();
    expect(s.unitPrice).toBe(3500);
    expect(s.shippingFee).toBe(800);
    expect(s.openAt).toBe('2026-08-22');
    expect(s.closeAt).toBe('2026-08-29');
  });

  it('保存した設定が読み戻せる', async () => {
    const s = await db.resolveTshirtSettings();
    await db.saveTshirtSettings({ ...s, unitPrice: 4000, isOpen: false, imageUrl: '/merch/new.jpg' });
    const got = await db.resolveTshirtSettings();
    expect(got.unitPrice).toBe(4000);
    expect(got.isOpen).toBe(false);
    expect(got.imageUrl).toBe('/merch/new.jpg');
    await db.saveTshirtSettings(s);
  });
});
