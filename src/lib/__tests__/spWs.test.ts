// 特設ワークショップ: 料金・定員・締切・入力チェック・受付番号・申込→決済確定(実DB)。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import {
  buildSpWsConfirmEmail,
  calcSpWsAmount,
  calcSpWsRemaining,
  formatSpWsReceiptNo,
  isSpWsAccepting,
  parseSpWsAge,
  spWsGateError,
  spWsNeedsGuardian,
  validateSpWsEntry,
  venueLabel,
  type SpWsEvent,
} from '../spWs';
import { buildSpWsCheckoutFormParams, parseSpWsWebhookEvent } from '../spWsStripe';

const TEST_DB = './data/test_sp_ws.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../spWsDb');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../spWsDb');
  await core.initDb();
  const sql = readFileSync('scripts/migrations/20261124_sp_ws_tables.sql', 'utf8');
  for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await core.execute(stmt);
});

const EV: SpWsEvent = {
  slug: 'my', title: 'My SPECIAL WORKSHOP', subtitle: '', instructorName: 'My', instructorKana: '', instructorFrom: 'from KOREA',
  instructorBio: '', instructorGenre: '', instructorInstagram: '', photoUrl: '', description: '',
  eventDate: '2026-12-22', startTime: '19:30', endTime: '21:00', venue: '', venueAddress: '',
  fee: 2000, capacity: 20, entryDeadline: '2026-12-21T23:59', entryOpen: true, belongings: '動きやすい服\n室内用のシューズ\n飲み物',
  target: '', cancelPolicy: '', contact: 'BOOM公式LINE',
};

const OK = { name: '山田 花子', kana: 'やまだ はなこ', email: 'a@example.com', phone: '090-1234-5678', age: '20', isMember: false, payMethod: 'card' as const, agreePolicy: true };

describe('料金・定員・締切', () => {
  it('参加費は会員・一般とも同じ(1人分)', () => {
    expect(calcSpWsAmount(EV)).toBe(2000);
    expect(calcSpWsAmount({ fee: -5 })).toBe(0);
  });
  it('残り枠は 定員 − 使用中。マイナスにならない', () => {
    expect(calcSpWsRemaining(20, 0)).toBe(20);
    expect(calcSpWsRemaining(20, 19)).toBe(1);
    expect(calcSpWsRemaining(20, 25)).toBe(0);
  });
  it('締切の 23:59 までは受け付け、日付が変わったら締め切る', () => {
    expect(isSpWsAccepting(EV, '2026-12-21T23:59', 5)).toBe(true);
    expect(spWsGateError(EV, '2026-12-22T00:00', 5)).toMatch(/締め切りました/);
  });
  it('定員に達したら受付終了・受付フラグが閉なら受け付けない', () => {
    expect(spWsGateError(EV, '2026-12-01T10:00', 0)).toMatch(/定員/);
    expect(spWsGateError({ ...EV, entryOpen: false }, '2026-12-01T10:00', 5)).toMatch(/受け付けていません/);
  });
  it('会場が空なら「調整中」', () => {
    expect(venueLabel(EV)).toMatch(/調整中/);
    expect(venueLabel({ venue: 'BOOM本校' })).toBe('BOOM本校');
  });
});

describe('入力チェック', () => {
  it('OKなら整えた値(会員は自己申告)', () => {
    const v = validateSpWsEntry({ ...OK, isMember: true });
    expect(typeof v).toBe('object');
    if (typeof v === 'object') { expect(v.isMember).toBe(true); expect(v.age).toBe(20); expect(v.guardianName).toBe(''); }
  });
  it('会員かどうかを選んでいないとNG', () => {
    expect(validateSpWsEntry({ ...OK, isMember: undefined })).toMatch(/会員/);
  });
  it('名前・ふりがな・メール・電話・年齢が無いとNG', () => {
    expect(validateSpWsEntry({ ...OK, name: '' })).toMatch(/お名前/);
    expect(validateSpWsEntry({ ...OK, kana: '' })).toMatch(/ふりがな/);
    expect(validateSpWsEntry({ ...OK, email: 'x' })).toMatch(/メール/);
    expect(validateSpWsEntry({ ...OK, phone: '123' })).toMatch(/電話/);
    expect(validateSpWsEntry({ ...OK, age: 'abc' })).toMatch(/年齢/);
  });
  it('年齢は全角・「歳」つきも受ける', () => {
    expect(parseSpWsAge('１５歳')).toBe(15);
    expect(parseSpWsAge('2')).toBeNull();
  });
  it('18歳未満は保護者の名前と同意が要る', () => {
    expect(spWsNeedsGuardian(17)).toBe(true);
    expect(spWsNeedsGuardian(18)).toBe(false);
    expect(validateSpWsEntry({ ...OK, age: '15' })).toMatch(/保護者/);
    expect(validateSpWsEntry({ ...OK, age: '15', guardianName: '山田 母' })).toMatch(/同意/);
    expect(typeof validateSpWsEntry({ ...OK, age: '15', guardianName: '山田 母', guardianConsent: true })).toBe('object');
  });
  it('同意が無いとNG・支払い方法は card か onsite(それ以外は card)', () => {
    expect(validateSpWsEntry({ ...OK, agreePolicy: false })).toMatch(/同意/);
    const v = validateSpWsEntry({ ...OK, payMethod: 'bitcoin' as never });
    expect(typeof v === 'object' && v.payMethod).toBe('card');
  });
});

describe('受付番号・メール・Stripe', () => {
  it('受付番号は MY-001 の形。確定前は「—」・テストは「テスト」', () => {
    expect(formatSpWsReceiptNo({ receiptSeq: 1 }, 'my')).toBe('MY-001');
    expect(formatSpWsReceiptNo({ receiptSeq: 12 }, 'my')).toBe('MY-012');
    expect(formatSpWsReceiptNo({ receiptSeq: null, paymentStatus: 'pending' }, 'my')).toBe('—');
    expect(formatSpWsReceiptNo({ receiptSeq: null, paymentStatus: 'test' }, 'my')).toBe('テスト');
  });
  it('確定メールに受付番号・日時・会場(調整中)・当日払いの案内が入り、名前はエスケープする', () => {
    const m = buildSpWsConfirmEmail({ receiptSeq: 3, name: '<b>花子</b>', amountTotal: 2000, paymentStatus: 'onsite' }, EV, { completeUrl: 'https://x/ws/complete?t=abc' });
    expect(m.subject).toContain('MY-003');
    expect(m.text).toContain('2026年12月22日(火) 19:30〜21:00');
    expect(m.text).toContain('調整中');
    expect(m.text).toContain('現金');
    expect(m.html).toContain('&lt;b&gt;花子');
    expect(m.html).not.toContain('<b>花子');
  });
  it('metadata は sp_ws_entry_id・ほかの注文のイベントは拾わない', () => {
    const p = buildSpWsCheckoutFormParams({ entry: { entryId: 7, name: 'A', amountTotal: 2000, email: 'a@example.com', slug: 'my' }, ev: EV, successUrl: 's', cancelUrl: 'c' });
    expect(p.get('metadata[sp_ws_entry_id]')).toBe('7');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('2000');
    expect(parseSpWsWebhookEvent({ id: 'evt', type: 'checkout.session.completed', data: { object: { metadata: { battle_entry_id: '1' } } } })).toBeNull();
    expect(parseSpWsWebhookEvent({ id: 'evt', type: 'checkout.session.completed', data: { object: { id: 'cs', metadata: { sp_ws_entry_id: '7' }, amount_total: 2000 } } })?.entryId).toBe(7);
  });
});

describe('申込→決済確定(実DB)', () => {
  it('マイグレーションで slug=my の行が入る(会場は空=調整中)', async () => {
    const ev = await db.getSpWsEvent('my');
    expect(ev?.fee).toBe(2000);
    expect(ev?.capacity).toBe(20);
    expect(ev?.venue).toBe('');
    expect(ev?.entryDeadline).toBe('2026-12-21T23:59');
    expect(await db.getSpWsEvent('../x')).toBeNull();
  });
  it('当日払いは申込で確定し受付番号が付く・カードは仮押さえ→Webhookで確定し次の番号・重複Webhookは無視', async () => {
    const ev = (await db.getSpWsEvent('my'))!;
    const v1 = validateSpWsEntry({ ...OK, payMethod: 'onsite' });
    if (typeof v1 === 'string') throw new Error(v1);
    const r1 = await db.createSpWsEntry(ev, v1);
    expect(r1.ok && r1.status).toBe('onsite');
    const e1 = await db.loadSpWsEntryByToken(r1.ok ? r1.editToken : '');
    expect(formatSpWsReceiptNo(e1!, 'my')).toBe('MY-001');

    const v2 = validateSpWsEntry(OK);
    if (typeof v2 === 'string') throw new Error(v2);
    const r2 = await db.createSpWsEntry(ev, v2);
    expect(r2.ok && r2.status).toBe('pending');
    expect(await db.getSpWsRemaining(ev)).toBe(18);
    if (!r2.ok) throw new Error();
    const hook = { eventId: 'evt_1', type: 'checkout.session.completed', sessionId: 'cs_1', paymentIntentId: 'pi_1', entryId: r2.entryId, amountTotal: 2000, currency: 'jpy' };
    const a = await db.applySpWsWebhookEvent(hook, '{}');
    expect(a.status).toBe('paid');
    if (a.status === 'paid') { expect(formatSpWsReceiptNo(a.entry, 'my')).toBe('MY-002'); expect(a.amountMismatch).toBe(false); }
    expect((await db.applySpWsWebhookEvent(hook, '{}')).status).toBe('duplicate');

    // 当日払いの受け取り
    expect(await db.markSpWsOnsitePaid(r1.ok ? r1.entryId : 0)).toBe(true);
    const list = await db.listSpWsEntriesStaff('my');
    expect(list.map((x) => x.paymentStatus)).toEqual(['paid', 'paid']);
    expect(list[1].paymentIntentId).toBe('pi_1');
  });
  it('定員を超えては申し込めない・テストは枠を消費しない', async () => {
    const ev = { ...(await db.getSpWsEvent('my'))!, capacity: 2 };
    const v = validateSpWsEntry(OK);
    if (typeof v === 'string') throw new Error(v);
    const full = await db.createSpWsEntry(ev, v);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error).toMatch(/定員/);
    const t = await db.createSpWsEntry(ev, v, { test: true });
    expect(t.ok && t.status).toBe('test');
    expect(await db.getSpWsRemaining(ev)).toBe(0);
  });
});
