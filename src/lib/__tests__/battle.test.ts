// 月1プチバトル: 年齢判定・料金・締切・入力チェック・申込→決済確定(実DB)。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import {
  ageOn,
  battleGateError,
  buildBattleConfirmEmail,
  calcBattleAmount,
  formatBattleReceiptNo,
  isAgeEligible,
  needsGuardian,
  nowJstMinute,
  validateBattleEntry,
  type BattleEvent,
} from '../battle';
import { parseBattleWebhookEvent, buildBattleCheckoutFormParams } from '../battleStripe';

const TEST_DB = './data/test_battle.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../battleDb');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../battleDb');
  await core.initDb();
  // rate_limits など他の表は要らない。この機能のマイグレーションだけ流す(migrate.mjs と同じ分け方)
  const sql = readFileSync('scripts/migrations/20261119_battle_tables.sql', 'utf8');
  for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await core.execute(stmt);
});

const U12 = { key: 'u12', name: 'U12', note: '', capacity: 2, maxAge: 12 };
const OPEN = { key: 'open', name: 'ALL AGE', note: '', capacity: 16, maxAge: null };
const EV: BattleEvent = {
  eventKey: '2026-12-26', title: 'テスト', subtitle: '', description: '', eventDate: '2026-12-26',
  openTime: '14:00', startTime: '14:40', endTime: '18:00', venue: 'V', venueAddress: '', moveSeconds: 45,
  divisions: [U12, OPEN], entryFee: 2000, entryFeeLate: 2500, lateFeeFrom: '2026-12-25T18:00',
  spectatorFee: 1000, spectatorNote: '', entryDeadline: '2026-12-25T18:00', entryOpen: true, rules: '', cancelPolicy: '',
};

const input = (over: Record<string, unknown> = {}) => ({
  email: 'a@example.com', dancerName: 'TARO', dancerKana: 'たろー', realName: 'テスト 太郎', birthdate: '2010-05-01',
  rep: '仙台', genre: 'HIPHOP', phone: '090-1234-5678', instagram: 'taro', divisions: ['open'], noWinConfirmed: true,
  spectators: 1, spectatorsPreschool: 1, guardianName: '保護者', guardianConsent: true, agreePolicy: true, ...over,
});

describe('年齢と部門', () => {
  it('満年齢は誕生日の前日まで1つ下', () => {
    expect(ageOn('2014-12-26', '2026-12-26')).toBe(12);
    expect(ageOn('2014-12-27', '2026-12-26')).toBe(11);
    expect(ageOn('2013-12-26', '2026-12-26')).toBe(13);
    expect(ageOn('bad', '2026-12-26')).toBeNull();
  });
  it('U12は開催日に12歳以下だけ', () => {
    expect(isAgeEligible(U12, '2014-12-26', EV.eventDate)).toBe(true);
    expect(isAgeEligible(U12, '2013-12-26', EV.eventDate)).toBe(false);
    expect(isAgeEligible(OPEN, '1980-01-01', EV.eventDate)).toBe(true);
  });
  it('18歳未満は保護者が要る(申込日で判定)', () => {
    expect(needsGuardian('2008-11-20', '2026-11-19')).toBe(true);
    expect(needsGuardian('2008-11-19', '2026-11-19')).toBe(false);
  });
});

describe('料金と締切', () => {
  it('部門ごとのエントリー料＋観覧(未就学児は無料)', () => {
    const a = calcBattleAmount(EV, 2, 1, '2026-12-01T10:00');
    expect(a.total).toBe(2000 * 2 + 1000);
  });
  it('前日18:00以降は遅い料金', () => {
    expect(calcBattleAmount(EV, 1, 0, '2026-12-25T18:00').entryUnit).toBe(2500);
    expect(calcBattleAmount(EV, 1, 0, '2026-12-25T17:59').entryUnit).toBe(2000);
  });
  it('締切を過ぎたら受け付けない・閉じていても受け付けない', () => {
    expect(battleGateError(EV, '2026-12-25T17:59')).toBeNull();
    expect(battleGateError(EV, '2026-12-25T18:00')).toContain('締め切り');
    expect(battleGateError({ ...EV, entryOpen: false }, '2026-12-01T00:00')).toContain('受け付けていません');
  });
  it('JSTの時刻(UTC+9)で比べる', () => {
    expect(nowJstMinute(new Date('2026-12-25T09:00:00Z'))).toBe('2026-12-25T18:00');
  });
});

describe('入力チェック', () => {
  it('OKなら整えた値を返す', () => {
    const v = validateBattleEntry(input(), EV, '2026-11-19');
    expect(typeof v).toBe('object');
    if (typeof v === 'string') return;
    expect(v.instagram).toBe('@taro');
  });
  it('U12に年齢オーバーは出られない', () => {
    expect(validateBattleEntry(input({ divisions: ['u12'] }), EV, '2026-11-19')).toContain('12歳以下');
  });
  it('優勝未経験のチェックが無いとNG', () => {
    expect(validateBattleEntry(input({ noWinConfirmed: false }), EV, '2026-11-19')).toContain('優勝未経験');
  });
  it('18歳未満は保護者の名前と同意が要る / 18歳以上は保護者欄を捨てる', () => {
    expect(validateBattleEntry(input({ guardianName: '' }), EV, '2026-11-19')).toContain('保護者');
    const adult = validateBattleEntry(input({ birthdate: '1990-01-01', guardianName: 'x' }), EV, '2026-11-19');
    expect(typeof adult === 'object' && adult.guardianName).toBe('');
  });
  it('知らない部門はNG・規定への同意が要る', () => {
    expect(validateBattleEntry(input({ divisions: ['zzz'] }), EV, '2026-11-19')).toContain('部門');
    expect(validateBattleEntry(input({ agreePolicy: false }), EV, '2026-11-19')).toContain('同意');
  });
});

describe('Stripe・メール', () => {
  it('metadata は battle_entry_id(BF6の order_id は使わない)', () => {
    const p = buildBattleCheckoutFormParams({ lineItems: [{ name: 'x', unitAmount: 2000, qty: 1 }], successUrl: 's', cancelUrl: 'c', customerEmail: 'a@example.com', entryId: 7, eventKey: '2026-12-26' });
    expect(p.get('metadata[battle_entry_id]')).toBe('7');
    expect(p.get('metadata[order_id]')).toBeNull();
  });
  it('ほかの注文のイベントは拾わない', () => {
    expect(parseBattleWebhookEvent({ id: 'evt', type: 'checkout.session.completed', data: { object: { metadata: { order_id: '3' } } } })).toBeNull();
    expect(parseBattleWebhookEvent({ id: 'evt', type: 'checkout.session.completed', data: { object: { id: 'cs', metadata: { battle_entry_id: '3' } } } })?.entryId).toBe(3);
  });
  it('確定メールに受付番号・部門・会場が入る', () => {
    const m = buildBattleConfirmEmail(
      { entryId: 3, eventKey: '2026-12-26', dancerName: 'TARO', dancerKana: 'たろー', divisions: ['open'], spectators: 1, spectatorsPreschool: 0, entryUnit: 2000, spectatorUnit: 1000, amountTotal: 3000 },
      EV, { completeUrl: 'https://x/c', entriesUrl: 'https://x/e' }
    );
    expect(formatBattleReceiptNo(3, '2026-12-26')).toBe('BT1226-003');
    expect(m.subject).toContain('BT1226-003');
    expect(m.text).toContain('ALL AGE');
    expect(m.text).toContain('2026年12月26日(土)');
  });
});

describe('申込→決済確定(実DB)', () => {
  it('シードの第1回が入っていて、設定から読める', async () => {
    const ev = await db.getBattleEvent('2026-12-26');
    expect(ev?.divisions.map((d) => d.key)).toEqual(['u12', 'open']);
    expect(ev?.entryOpen).toBe(false);
    expect(ev?.entryDeadline).toBe('2026-12-25T18:00');
  });

  it('仮押さえ→Webhookで確定、再送は何もしない、公開一覧に本名を出さない', async () => {
    const v = validateBattleEntry(input(), EV, '2026-11-19');
    if (typeof v === 'string') throw new Error(v);
    const r = await db.createBattleEntry(EV, v, '2026-11-19T10:00');
    if (!r.ok) throw new Error(r.error);
    expect(r.status).toBe('pending');
    expect(r.amountTotal).toBe(3000);
    expect(await db.getPublicBattleEntries(EV.eventKey)).toHaveLength(0);

    const wh = { eventId: 'evt_battle_1', type: 'checkout.session.completed', sessionId: 'cs_1', paymentIntentId: 'pi_1', entryId: r.entryId, amountTotal: 3000, currency: 'jpy' };
    expect((await db.applyBattleWebhookEvent(wh, '{}')).status).toBe('paid');
    expect((await db.applyBattleWebhookEvent(wh, '{}')).status).toBe('duplicate');
    const pub = await db.getPublicBattleEntries(EV.eventKey);
    expect(pub).toEqual([{ dancerName: 'TARO', rep: '仙台', genre: 'HIPHOP', divisions: ['open'] }]);
  });

  it('定員を超える申込は断る・テスト申込は枠を使わない', async () => {
    const kid = validateBattleEntry(input({ birthdate: '2015-01-01', divisions: ['u12'], email: 'k@example.com' }), EV, '2026-11-19');
    if (typeof kid === 'string') throw new Error(kid);
    expect((await db.createBattleEntry(EV, kid, '2026-11-19T10:00', { test: true })).ok).toBe(true);
    expect((await db.createBattleEntry(EV, kid, '2026-11-19T10:00')).ok).toBe(true);
    expect((await db.createBattleEntry(EV, kid, '2026-11-19T10:00')).ok).toBe(true);
    const third = await db.createBattleEntry(EV, kid, '2026-11-19T10:00');
    expect(third.ok).toBe(false);
    expect((await db.getBattleRemaining(EV)).u12).toBe(0);
  });

  it('30分を過ぎた決済待ちは期限切れになって枠が戻る', async () => {
    await core.execute("UPDATE battle_entries SET expires_at = '2000-01-01T00:00:00.000Z' WHERE payment_status = 'pending'");
    expect((await db.getBattleRemaining(EV)).u12).toBe(2);
  });

  it('新しい回は設定をコピーし、締切は前日18:00・受付は閉で作る', async () => {
    expect(await db.createBattleEventFrom('2026-12-26', '2027-01-30')).toBe(true);
    const next = await db.getBattleEvent('2027-01-30');
    expect(next?.entryDeadline).toBe('2027-01-29T18:00');
    expect(next?.entryOpen).toBe(false);
    expect(next?.divisions).toHaveLength(2);
    expect(await db.createBattleEventFrom('2026-12-26', '2027-01-30')).toBe(false);
  });
});
