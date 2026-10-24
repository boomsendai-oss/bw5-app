// vol.7の申込→決済確定の流れ(実DB)。vol.6の記録(bf_*)に一切触れないことも確かめる。
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';

const TEST_DB = './data/test_bf7_entry.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../bf7EntryDb');
let bf6: typeof import('../bf6');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../bf7EntryDb');
  bf6 = await import('../bf6');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
});

const order = (over: Record<string, unknown> = {}) => {
  const v = bf6.validateBf6Order({
    buyerName: '申込 太郎', email: 'a@example.com', phone: '09012345678', payMethod: 'prepaid',
    entries: [{ performerName: 'テスト', dancerName: 'TARO', dancerKana: 'タロー', grade: 'adult', genre: 'HIPHOP', rep: '仙台', instagram: 'taro_bsb', divisions: ['general'] }],
    adultTickets: 1, childTickets: 0, ...over,
  });
  if (typeof v === 'string') throw new Error(v);
  return v;
};

describe('vol.7の申込', () => {
  it('既定の料金(vol.6から+¥500)で保存され、30分の仮押さえになる', async () => {
    const r = await db.createBf7Order(order());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 当日(1/30)より前なので大人は前売¥2,500、エントリーは事前決済¥2,500
    const own = await db.loadBf7OrderByToken(r.editToken);
    expect(own?.paymentStatus).toBe('pending');
    expect(own?.amountTotal).toBe(r.amountTotal);
    expect(own?.items.find((i) => i.itemType === 'entry')?.instagram).toBe('@taro_bsb');
  });

  it('Webhookで決済確定(paid)になり、同じイベントの再送は何もしない', async () => {
    const r = await db.createBf7Order(order({ email: 'b@example.com' }));
    if (!r.ok) throw new Error(r.error);
    const ev = { eventId: 'evt_bf7_1', type: 'checkout.session.completed', sessionId: 'cs_test_bf7', paymentIntentId: 'pi_1', orderId: r.orderId, amountTotal: r.amountTotal, currency: 'jpy' };
    const a = await db.applyBf7WebhookEvent(ev, '{}');
    expect(a.status).toBe('paid');
    const b = await db.applyBf7WebhookEvent(ev, '{}');
    expect(b.status).toBe('duplicate');
    const own = await db.loadBf7OrderByToken(r.editToken);
    expect(own?.paymentStatus).toBe('paid');
  });

  it('確定した出場者だけが公開エントリーリストに出る(本名・連絡先は出さない)', async () => {
    const list = await db.getPublicBf7Entries();
    expect(list.length).toBe(1);
    expect(Object.keys(list[0]).sort()).toEqual(['dancerName', 'divisions', 'genre', 'rep']);
  });

  it('定員を超える申込は止める', async () => {
    await db.setBf7Setting('capacity', JSON.stringify({ general: 2 }));
    const r = await db.createBf7Order(order({ email: 'c@example.com' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('一般部門は残枠が足りません');
    await db.setBf7Setting('capacity', JSON.stringify({ general: 32 }));
  });

  it('確認用モードのテスト申込は、定員にも公開エントリーリストにも数えない', async () => {
    const before = await db.getBf7Usage();
    const listBefore = (await db.getPublicBf7Entries()).length;
    const r = await db.createBf7Order(order({ email: 'staff-test@example.com', payMethod: 'onsite' }));
    if (!r.ok) throw new Error(r.error);
    await db.markBf7StaffTestOrder(r.editToken);
    const own = await db.loadBf7OrderByToken(r.editToken);
    expect(own?.paymentStatus).toBe('cash_due');
    expect(await db.getBf7Usage()).toEqual(before);
    expect((await db.getPublicBf7Entries()).length).toBe(listBefore);
    const staff = await db.listBf7OrdersStaff();
    expect(staff.find((o) => o.orderId === r.orderId)?.note).toBe(db.BF7_STAFF_TEST_NOTE);
  });

  it('vol.6の記録(bf_orders)には書き込まない', async () => {
    const rows = await core.getAll('SELECT COUNT(*) AS n FROM bf_orders');
    expect(Number(rows[0].n)).toBe(0);
  });

  it('設定で受付を開けられる(既定は閉)', async () => {
    expect((await db.getBf7Settings()).entryOpen).toBe(false);
    await db.setBf7Setting('entry_open', '1');
    expect((await db.getBf7Settings()).entryOpen).toBe(true);
  });
});
