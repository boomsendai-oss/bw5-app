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
  nextRoundTitle,
  roundKanji,
  nowJstMinute,
  parseBattleAge,
  entryAge,
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
  for (const f of ['20261119_battle_tables.sql', '20261119_battle_tables_2_cast.sql', '20261121_battle_entries_age.sql', '20261121_battle_entries_receipt_seq.sql', '20261121_battle_events_round_no.sql']) {
    const sql = readFileSync(`scripts/migrations/${f}`, 'utf8');
    for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await core.execute(stmt);
  }
});

const U12 = { key: 'u12', name: 'U12', note: '', capacity: 2, maxAge: 12 };
const OPEN = { key: 'open', name: 'ALL AGE', note: '', capacity: 16, maxAge: null };
const EV: BattleEvent = {
  eventKey: '2026-12-26', roundNo: 1, title: 'テスト', subtitle: '', description: '', eventDate: '2026-12-26',
  openTime: '14:00', startTime: '14:40', endTime: '18:00', venue: 'V', venueAddress: '', moveSeconds: 45,
  divisions: [U12, OPEN], entryFee: 2000, entryFeeLate: 2500, lateFeeFrom: '2026-12-25T18:00',
  spectatorFee: 1000, spectatorNote: '', entryDeadline: '2026-12-25T18:00', entryOpen: true, rules: '', cancelPolicy: '', cast: [],
};

const input = (over: Record<string, unknown> = {}) => ({
  email: 'a@example.com', dancerName: 'TARO', dancerKana: 'たろー', realName: 'テスト 太郎', age: 16,
  rep: '仙台', genre: 'HIPHOP', phone: '090-1234-5678', instagram: 'taro', divisions: ['open'], noWinConfirmed: true,
  spectators: 1, spectatorsPreschool: 1, guardianName: '保護者', guardianConsent: true, agreePolicy: true, cancelFeeAgreed: true, ...over,
});

describe('年齢と部門', () => {
  it('満年齢は誕生日の前日まで1つ下', () => {
    expect(ageOn('2014-12-26', '2026-12-26')).toBe(12);
    expect(ageOn('2014-12-27', '2026-12-26')).toBe(11);
    expect(ageOn('2013-12-26', '2026-12-26')).toBe(13);
    expect(ageOn('bad', '2026-12-26')).toBeNull();
  });
  it('U12は開催日に12歳以下だけ(入力した年齢の数字で判定)', () => {
    expect(isAgeEligible(U12, 12)).toBe(true);
    expect(isAgeEligible(U12, 13)).toBe(false);
    expect(isAgeEligible(U12, null)).toBe(false);
    expect(isAgeEligible(OPEN, 46)).toBe(true);
  });
  it('18歳未満は保護者が要る(開催日の年齢で判定)', () => {
    expect(needsGuardian(17)).toBe(true);
    expect(needsGuardian(18)).toBe(false);
    expect(needsGuardian(null)).toBe(false);
  });
  it('年齢の入力は数字だけ(全角・「歳」つきも可)・範囲外はNG', () => {
    expect(parseBattleAge('11')).toBe(11);
    expect(parseBattleAge('１１')).toBe(11);
    expect(parseBattleAge('11歳')).toBe(11);
    expect(parseBattleAge(11)).toBe(11);
    expect(parseBattleAge('')).toBeNull();
    expect(parseBattleAge('abc')).toBeNull();
    expect(parseBattleAge('2')).toBeNull();
    expect(parseBattleAge('101')).toBeNull();
    expect(parseBattleAge('11.5')).toBeNull();
  });
  it('前の申込(生年月日だけ)は生年月日から年齢を出す', () => {
    expect(entryAge({ age: 11, birthdate: '' }, '2026-12-26')).toBe(11);
    expect(entryAge({ age: null, birthdate: '2014-12-26' }, '2026-12-26')).toBe(12);
    expect(entryAge({ age: null, birthdate: '' }, '2026-12-26')).toBeNull();
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
    const v = validateBattleEntry(input(), EV);
    expect(typeof v).toBe('object');
    if (typeof v === 'string') return;
    expect(v.instagram).toBe('@taro');
  });
  it('U12に年齢オーバーは出られない', () => {
    expect(validateBattleEntry(input({ divisions: ['u12'] }), EV)).toContain('12歳以下');
  });
  it('優勝未経験のチェックが無いとNG', () => {
    expect(validateBattleEntry(input({ noWinConfirmed: false }), EV)).toContain('優勝未経験');
  });
  it('年齢が無い・数字でないとNG', () => {
    expect(validateBattleEntry(input({ age: '' }), EV)).toContain('年齢');
    expect(validateBattleEntry(input({ age: 'じゅう' }), EV)).toContain('年齢');
  });
  it('18歳未満は保護者の名前と同意が要る / 18歳以上は保護者欄を捨てる', () => {
    expect(validateBattleEntry(input({ guardianName: '' }), EV)).toContain('保護者');
    const adult = validateBattleEntry(input({ age: 36, guardianName: 'x' }), EV);
    expect(typeof adult === 'object' && adult.guardianName).toBe('');
  });
  it('知らない部門はNG・規定への同意が要る', () => {
    expect(validateBattleEntry(input({ divisions: ['zzz'] }), EV)).toContain('部門');
    expect(validateBattleEntry(input({ agreePolicy: false }), EV)).toContain('同意');
  });
  it('キャンセル料への同意が要る・支払い方法は card か onsite(それ以外は card)', () => {
    expect(validateBattleEntry(input({ cancelFeeAgreed: false }), EV)).toContain('キャンセル料');
    const a = validateBattleEntry(input({ payMethod: 'onsite' }), EV);
    expect(typeof a === 'object' && a.payMethod).toBe('onsite');
    const b = validateBattleEntry(input({ payMethod: 'zzz' }), EV);
    expect(typeof b === 'object' && b.payMethod).toBe('card');
  });
  it('U12の年齢ならU12とALL AGEのダブルエントリーができる', () => {
    const v = validateBattleEntry(input({ age: 11, divisions: ['u12', 'open'] }), EV);
    expect(typeof v === 'object' && v.divisions).toEqual(['u12', 'open']);
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
  it('受付番号は BD01-001 の形(BD=BOOM DOJO・回・回の中の連番)。確定前は番号なし・テストは「テスト」', () => {
    expect(formatBattleReceiptNo({ receiptSeq: 3 }, 1)).toBe('BD01-003');
    expect(formatBattleReceiptNo({ receiptSeq: 12 }, 2)).toBe('BD02-012');
    expect(formatBattleReceiptNo({ receiptSeq: 1 }, 0)).toBe('BD00-001');
    expect(formatBattleReceiptNo({ receiptSeq: null, paymentStatus: 'pending' }, 1)).toBe('—');
    expect(formatBattleReceiptNo({ receiptSeq: null, paymentStatus: 'test' }, 1)).toBe('テスト');
  });
  it('回の漢数字と、新しい回のタイトル', () => {
    expect(roundKanji(1)).toBe('一');
    expect(roundKanji(10)).toBe('十');
    expect(roundKanji(12)).toBe('十二');
    expect(roundKanji(21)).toBe('二十一');
    expect(nextRoundTitle('BOOM DOJO 其の一', 2)).toBe('BOOM DOJO 其の二');
    expect(nextRoundTitle('BOOM DOJO 其の九', 10)).toBe('BOOM DOJO 其の十');
    expect(nextRoundTitle('【テスト】BOOM DOJO', 2)).toBe('【テスト】BOOM DOJO');
  });
  it('確定メールに受付番号・バトルエントリーと観覧チケットの見出し・合計・支払い方法が入る', () => {
    const m = buildBattleConfirmEmail(
      { receiptSeq: 3, dancerName: 'TARO', dancerKana: 'たろー', divisions: ['u12', 'open'], spectators: 2, spectatorsPreschool: 1, entryUnit: 2000, spectatorUnit: 1000, amountTotal: 6000, paymentStatus: 'paid', stripeSessionId: 'cs_1' },
      EV, { completeUrl: 'https://x/c', entriesUrl: 'https://x/e' }
    );
    expect(m.subject).toContain('BD01-003');
    expect(m.subject).not.toContain('No.');
    expect(m.text).toContain('■ バトルエントリー\n  U12  ¥2,000\n  ALL AGE  ¥2,000');
    expect(m.text).toContain('■ 観覧チケット\n  小学生以上 2名  ¥1,000 × 2 = ¥2,000\n  未就学児 1名  無料');
    expect(m.text).toContain('■ 合計  ¥6,000');
    expect(m.text).toContain('カードでお支払い済み');
    expect(m.text).toContain('2026年12月26日(土)');
  });
  it('観覧なしは「なし」と出る', () => {
    const m = buildBattleConfirmEmail(
      { receiptSeq: 1, dancerName: 'TARO', dancerKana: 'たろー', divisions: ['open'], spectators: 0, spectatorsPreschool: 0, entryUnit: 2000, spectatorUnit: 1000, amountTotal: 2000, paymentStatus: 'paid' },
      EV, { completeUrl: 'https://x/c', entriesUrl: 'https://x/e' }
    );
    expect(m.text).toContain('■ 観覧チケット\n  なし');
  });
  it('当日払いの確定メールは「当日、受付で現金」とキャンセル料の注意が入る', () => {
    const m = buildBattleConfirmEmail(
      { receiptSeq: 4, dancerName: 'TARO', dancerKana: 'たろー', divisions: ['open'], spectators: 0, spectatorsPreschool: 0, entryUnit: 2000, spectatorUnit: 1000, amountTotal: 2000, paymentStatus: 'onsite' },
      EV, { completeUrl: 'https://x/c', entriesUrl: 'https://x/e' }
    );
    expect(m.text).toContain('当日、受付で現金');
    expect(m.text).toContain('キャンセル料');
    expect(m.text).not.toContain('お支払い済み');
  });
});

describe('申込→決済確定(実DB)', () => {
  it('シードの第1回が入っていて、設定から読める', async () => {
    const ev = await db.getBattleEvent('2026-12-26');
    expect(ev?.divisions.map((d) => d.key)).toEqual(['u12', 'open']);
    expect(ev?.entryOpen).toBe(false);
    expect(ev?.entryDeadline).toBe('2026-12-25T18:00');
    expect(ev?.roundNo).toBe(1);
  });

  it('仮押さえ→Webhookで確定、再送は何もしない、公開一覧に本名を出さない', async () => {
    const v = validateBattleEntry(input(), EV);
    if (typeof v === 'string') throw new Error(v);
    const r = await db.createBattleEntry(EV, v, '2026-11-19T10:00');
    if (!r.ok) throw new Error(r.error);
    expect(r.status).toBe('pending');
    expect(r.amountTotal).toBe(3000);
    expect(await db.getPublicBattleEntries(EV.eventKey)).toHaveLength(0);

    const wh = { eventId: 'evt_battle_1', type: 'checkout.session.completed', sessionId: 'cs_1', paymentIntentId: 'pi_1', entryId: r.entryId, amountTotal: 3000, currency: 'jpy' };
    const paid = await db.applyBattleWebhookEvent(wh, '{}');
    expect(paid.status).toBe('paid');
    expect(paid.status === 'paid' && paid.entry.receiptSeq).toBe(1);
    expect(paid.status === 'paid' && paid.entry.age).toBe(16);
    expect((await db.applyBattleWebhookEvent(wh, '{}')).status).toBe('duplicate');
    const pub = await db.getPublicBattleEntries(EV.eventKey);
    expect(pub).toEqual([{ dancerName: 'TARO', rep: '仙台', genre: 'HIPHOP', divisions: ['open'] }]);
  });

  it('定員を超える申込は断る・テスト申込は枠を使わない', async () => {
    const kid = validateBattleEntry(input({ age: 11, divisions: ['u12'], email: 'k@example.com' }), EV);
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
    // 第1回(其の一)のコピーは第2回(其の二)
    expect(next?.roundNo).toBe(2);
    expect(next?.title).toContain('其の二');
    expect(next?.divisions).toHaveLength(2);
    expect(await db.createBattleEventFrom('2026-12-26', '2027-01-30')).toBe(false);
  });
});

describe('当日払い(実DB)', () => {
  it('当日払いは申込で確定(onsite)・枠を使い・公開一覧に載る・受け取りで paid', async () => {
    const ev2: BattleEvent = { ...EV, eventKey: '2027-01-23', eventDate: '2027-01-23', entryDeadline: '2027-01-22T18:00', lateFeeFrom: '' };
    await core.execute("INSERT OR IGNORE INTO battle_events (event_key, title, event_date, divisions, entry_fee, created_at, updated_at) VALUES (?, 't', ?, ?, 2000, '', '')", [ev2.eventKey, ev2.eventDate, JSON.stringify(ev2.divisions)]);
    const v = validateBattleEntry(input({ payMethod: 'onsite', email: 'o@example.com', dancerName: 'ONSITE' }), ev2);
    if (typeof v === 'string') throw new Error(v);
    const r = await db.createBattleEntry(ev2, v, '2026-11-19T10:00');
    if (!r.ok) throw new Error(r.error);
    expect(r.status).toBe('onsite');
    // 回ごとの連番: この回(2027-01-23)では1番
    expect((await db.loadBattleEntryByToken(r.editToken))?.receiptSeq).toBe(1);
    expect((await db.getBattleRemaining(ev2)).open).toBe(15);
    expect((await db.getPublicBattleEntries(ev2.eventKey)).map((x) => x.dancerName)).toEqual(['ONSITE']);
    expect(await db.markBattleOnsitePaid(r.entryId)).toBe(true);
    expect(await db.markBattleOnsitePaid(r.entryId)).toBe(false);
    const after = await db.loadBattleEntryByToken(r.editToken);
    expect(after?.paymentStatus).toBe('paid');
    expect(after?.note).toContain('当日現金で受領');
  });

  it('受付番号は回ごとの連番・テスト申込と決済待ちは番号を使わない・生年月日は空で保存', async () => {
    const ev2: BattleEvent = { ...EV, eventKey: '2027-01-23', eventDate: '2027-01-23', entryDeadline: '2027-01-22T18:00', lateFeeFrom: '' };
    const v2 = validateBattleEntry(input({ payMethod: 'onsite', email: 'p@example.com', dancerName: 'ONSITE2', age: 9 }), ev2);
    if (typeof v2 === 'string') throw new Error(v2);
    const t = await db.createBattleEntry(ev2, v2, '2026-11-19T10:00', { test: true });
    if (!t.ok) throw new Error(t.error);
    expect((await db.loadBattleEntryByToken(t.editToken))?.receiptSeq).toBeNull();
    const card = validateBattleEntry(input({ email: 'c@example.com' }), ev2);
    if (typeof card === 'string') throw new Error(card);
    const pend = await db.createBattleEntry(ev2, card, '2026-11-19T10:00');
    if (!pend.ok) throw new Error(pend.error);
    expect((await db.loadBattleEntryByToken(pend.editToken))?.receiptSeq).toBeNull();
    const r2 = await db.createBattleEntry(ev2, v2, '2026-11-19T10:00');
    if (!r2.ok) throw new Error(r2.error);
    const row = await db.loadBattleEntryByToken(r2.editToken);
    expect(row?.receiptSeq).toBe(2);
    expect(row?.age).toBe(9);
    expect(row?.birthdate).toBe('');
    // 決済待ちが後から確定すると次の番号
    const wh = { eventId: 'evt_battle_seq', type: 'checkout.session.completed', sessionId: 'cs_seq', paymentIntentId: 'pi_seq', entryId: pend.entryId, amountTotal: 3000, currency: 'jpy' };
    const paid = await db.applyBattleWebhookEvent(wh, '{}');
    expect(paid.status === 'paid' && paid.entry.receiptSeq).toBe(3);
  });
});
