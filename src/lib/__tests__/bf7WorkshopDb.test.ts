// HIRO ワークショップの申込の流れ(実DB): 定員・仮押さえ・テスト申込・決済の通知・取消。
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import type { ValidatedBf7Ws } from '../bf7Workshop';

const TEST_DB = './data/test_bf7_ws.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../bf7WorkshopDb');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../bf7WorkshopDb');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
});

const order = (o: Partial<ValidatedBf7Ws> = {}): ValidatedBf7Ws => ({
  name: '試験 花子',
  kana: 'シケン ハナコ',
  age: '25歳',
  guardianName: '',
  phone: '09000000000',
  email: 'test@example.com',
  isMember: false,
  course: 'first',
  payMethod: 'transfer',
  note: '',
  ...o,
});

describe('申込の流れ', () => {
  it('確認用モードはカードも銀行振込も¥100で、本番の申込は通常の料金', async () => {
    const card = await db.createBf7WsOrder(order({ payMethod: 'prepaid', course: 'both' }), null, true);
    const transfer = await db.createBf7WsOrder(order({ course: 'both' }), null, true);
    const real = await db.createBf7WsOrder(order({ payMethod: 'prepaid', course: 'both' }), null, false);
    if (!card.ok || !transfer.ok || !real.ok) throw new Error('create failed');
    expect(card.amountTotal).toBe(100);
    expect(transfer.amountTotal).toBe(100);
    expect(real.amountTotal).toBe(7000);
    await db.cancelBf7WsOrder(card.id);
    await db.cancelBf7WsOrder(transfer.id);
    await db.cancelBf7WsOrder(real.id);
  });

  it('テスト申込は定員に数えない', async () => {
    const before = await db.getBf7WsRemaining();
    const r = await db.createBf7WsOrder(order(), null, true);
    expect(r.ok).toBe(true);
    expect(await db.getBf7WsRemaining()).toEqual(before);
  });

  it('会員の申告は照合の結果を保存し、金額は会員料金になる', async () => {
    const r = await db.createBf7WsOrder(order({ isMember: true, course: 'both' }), { check: 'review', candidateIds: [] }, false);
    if (!r.ok) throw new Error(r.error);
    expect(r.amountTotal).toBe(6000);
    const o = await db.loadBf7WsOrderByToken(r.token);
    expect(o?.memberCheck).toBe('review');
    expect(o?.first && o?.second).toBe(true);
    await db.cancelBf7WsOrder(r.id);
  });

  it('カード決済の通知で支払済みになり、同じ通知は1回だけ処理する', async () => {
    const r = await db.createBf7WsOrder(order({ payMethod: 'prepaid', course: 'second' }), null, false);
    if (!r.ok) throw new Error(r.error);
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('pending');
    const ev = { eventId: 'evt_ws_1', type: 'checkout.session.completed', sessionId: 'cs_1', orderId: r.id, amountTotal: 4000 };
    const first = await db.applyBf7WsWebhookEvent(ev);
    expect(first.status).toBe('paid');
    if (first.status === 'paid') expect(first.amountMismatch).toBe(false);
    expect((await db.applyBf7WsWebhookEvent(ev)).status).toBe('duplicate');
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('paid');
    await db.cancelBf7WsOrder(r.id);
  });

  it('30分で決済されなければ枠が空く', async () => {
    const before = await db.getBf7WsRemaining();
    const r = await db.createBf7WsOrder(order({ payMethod: 'prepaid' }), null, false);
    if (!r.ok) throw new Error(r.error);
    expect((await db.getBf7WsRemaining()).first).toBe(before.first - 1);
    await core.execute('UPDATE bf7_ws_orders SET expires_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', r.id]);
    expect(await db.getBf7WsRemaining()).toEqual(before);
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('expired');
  });

  it('Stripeの銀行振込: 振込先を保存し、入金の通知(payment_intent.succeeded)で支払済みになる', async () => {
    const r = await db.createBf7WsOrder(order({ course: 'first' }), null, false);
    if (!r.ok) throw new Error(r.error);
    const bank = { bank: '三井住友銀行', branch: '東京第二', type: '普通', number: '1234567', holder: 'ストライプジャパン（カ' };
    await db.saveBf7WsBankTransfer(r.id, 'pi_ws_1', bank);
    const saved = await db.loadBf7WsOrderByToken(r.token);
    expect(saved?.bankAccount).toEqual(bank);
    expect(saved?.stripePaymentIntentId).toBe('pi_ws_1');
    // 足りない入金の通知では変わらない
    expect((await db.applyBf7WsWebhookEvent({ eventId: 'evt_ws_pf', type: 'payment_intent.partially_funded', sessionId: 'pi_ws_1', orderId: r.id, amountTotal: null })).status).toBe('ignored');
    const ok = await db.applyBf7WsWebhookEvent({ eventId: 'evt_ws_bt', type: 'payment_intent.succeeded', sessionId: 'pi_ws_1', orderId: r.id, amountTotal: 4000 });
    expect(ok.status).toBe('paid');
    if (ok.status === 'paid') expect(ok.amountMismatch).toBe(false);
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('paid');
    await db.cancelBf7WsOrder(r.id);
  });

  it('振込の期限(申込日から7日)を過ぎた振込待ちは取り消して枠を空け、あとから入金が届けば支払済みにする', async () => {
    const before = await db.getBf7WsRemaining();
    const r = await db.createBf7WsOrder(order({ course: 'first' }), null, false);
    if (!r.ok) throw new Error(r.error);
    // 申込日から7日目まではそのまま
    await core.execute("UPDATE bf7_ws_orders SET applied_on = date('now', '+9 hours', '-7 days') WHERE id = ?", [r.id]);
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('transfer_due');
    await core.execute("UPDATE bf7_ws_orders SET applied_on = date('now', '+9 hours', '-8 days') WHERE id = ?", [r.id]);
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('expired');
    expect(await db.getBf7WsRemaining()).toEqual(before);
    const late = await db.applyBf7WsWebhookEvent({ eventId: 'evt_ws_late', type: 'payment_intent.succeeded', sessionId: 'pi_x', orderId: r.id, amountTotal: 4000 });
    expect(late.status).toBe('paid');
    await db.cancelBf7WsOrder(r.id);
  });

  it('要確認の人は、あとから入会すれば照合のやり直しで確認済みになる・会員ではないと判断した人は戻らない', async () => {
    const a = await db.createBf7WsOrder(order({ isMember: true, name: '新規 入会', kana: 'シンキ ニュウカイ' }), { check: 'review', candidateIds: [] }, false);
    const b = await db.createBf7WsOrder(order({ isMember: true, name: '新規 入会', kana: 'シンキ ニュウカイ' }), { check: 'review', candidateIds: [] }, false);
    if (!a.ok || !b.ok) throw new Error('create failed');
    await db.setBf7WsMemberCheck(b.id, 'rejected');
    await db.recheckBf7WsReview();
    expect((await db.getBf7WsOrderById(a.id))?.memberCheck).toBe('review');

    await core.execute("INSERT INTO boom_members (hacomono_member_id, full_name, full_name_kana, status) VALUES ('new1', '新規 入会', 'シンキ ニュウカイ', 'active')");
    expect(await db.recheckBf7WsReview()).toBe(1);
    const after = await db.getBf7WsOrderById(a.id);
    expect(after?.memberCheck).toBe('confirmed');
    expect(after?.matchedMemberId).toBeGreaterThan(0);
    expect((await db.getBf7WsOrderById(b.id))?.memberCheck).toBe('rejected');
    await db.cancelBf7WsOrder(a.id);
    await db.cancelBf7WsOrder(b.id);
  });

  it('振込の入金確認を付け外しできる・カードの行は変わらない', async () => {
    const r = await db.createBf7WsOrder(order(), null, false);
    if (!r.ok) throw new Error(r.error);
    expect(await db.setBf7WsTransferReceived(r.id, true)).toBe(true);
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('paid');
    expect(await db.setBf7WsTransferReceived(r.id, false)).toBe(true);
    expect((await db.loadBf7WsOrderByToken(r.token))?.paymentStatus).toBe('transfer_due');
    await db.cancelBf7WsOrder(r.id);
    const c = await db.createBf7WsOrder(order({ payMethod: 'prepaid' }), null, false);
    if (!c.ok) throw new Error(c.error);
    expect(await db.setBf7WsTransferReceived(c.id, true)).toBe(false);
    await db.cancelBf7WsOrder(c.id);
  });

  it('25名で満員になり、26人目は止まる。取消で1枠空く。もう一方のクラスは申し込める', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await db.createBf7WsOrder(order(), null, false);
      if (!r.ok) throw new Error(r.error);
      ids.push(r.id);
    }
    expect((await db.getBf7WsRemaining()).first).toBe(0);
    const over = await db.createBf7WsOrder(order(), null, false);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain('1本目');
    const both = await db.createBf7WsOrder(order({ course: 'both' }), null, false);
    expect(both.ok).toBe(false);
    const second = await db.createBf7WsOrder(order({ course: 'second' }), null, false);
    expect(second.ok).toBe(true);

    await db.cancelBf7WsOrder(ids[0]);
    expect((await db.getBf7WsRemaining()).first).toBe(1);
    expect((await db.createBf7WsOrder(order(), null, false)).ok).toBe(true);
  });
});
