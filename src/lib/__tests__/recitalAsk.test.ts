// BW6 発表会（段階1）の TARO への入金のスクショの声かけ（recitalAsk.ts・純）の試験。Task 24。
// 振込先は作り物。文に金額と名前を書かないことも確かめる。
import { describe, it, expect } from 'vitest';
import { jstToMs, parseRecitalSettings, payGate, type RecitalSettings } from '../recital';
import { buildAskMessage, nowJstOf, shouldAskTaro } from '../recitalAsk';

const s = parseRecitalSettings([
  { key: 'pay_open_at', value: '2026-12-15 12:00' }, { key: 'pay_ok_at', value: '2026-12-14 10:00' },
  { key: 'bank_text', value: '（試しの振込先）' }, { key: 'bank_ask_at', value: '19:00,20:30' },
  { key: 'bank_rest_from', value: '2026-12-30' }, { key: 'bank_rest_to', value: '2027-01-03' },
  { key: 'bank_audit_on', value: '2027-02-12' },
]);
const ask = (nowJst: string, slot: string, over: Partial<{ s: RecitalSettings; okBatchToday: boolean }> = {}) => {
  const ss = over.s ?? s;
  return shouldAskTaro({ nowJst, slot, s: ss, gate: payGate(ss, jstToMs(nowJst)), okBatchToday: over.okBatchToday ?? false });
};

describe('shouldAskTaro', () => {
  it('開けた日の夜から出る', () => { expect(ask('2026-12-15 19:00', '19:00')).toBe(true); expect(ask('2026-12-15 20:30', '20:30')).toBe(true); });
  it('開ける前は出ない', () => { expect(ask('2026-12-14 19:00', '19:00')).toBe(false); });
  it('pay_ok_at が空なら出ない', () => { expect(ask('2026-12-20 19:00', '19:00', { s: { ...s, pay_ok_at: null } })).toBe(false); });
  it('bank_text が空なら出ない', () => { expect(ask('2026-12-20 19:00', '19:00', { s: { ...s, bank_text: '' } })).toBe(false); });
  it('その日に合った束があれば出ない（20:30 も）', () => {
    expect(ask('2026-12-20 19:00', '19:00', { okBatchToday: true })).toBe(false);
    expect(ask('2026-12-20 20:30', '20:30', { okBatchToday: true })).toBe(false);
  });
  it('休みの境目：12/29 は出る・12/30〜1/3 は出ない・1/4 朝に1回・1/4 夜はふだんどおり', () => {
    expect(ask('2026-12-29 19:00', '19:00')).toBe(true);
    expect(ask('2026-12-30 19:00', '19:00')).toBe(false);
    expect(ask('2027-01-03 20:30', '20:30')).toBe(false);
    expect(ask('2027-01-04 08:00', '08:00')).toBe(true);
    expect(ask('2027-01-05 08:00', '08:00')).toBe(false);
    expect(ask('2026-12-20 08:00', '08:00')).toBe(false);
    expect(ask('2027-01-04 19:00', '19:00')).toBe(true);
  });
  it('bank_ask_at に無い時刻は出ない', () => { expect(ask('2026-12-20 12:00', '12:00')).toBe(false); });
  it('2/12 からは段階1では出ない（総点検の文は後の計画）', () => {
    expect(ask('2027-02-11 19:00', '19:00')).toBe(true);
    expect(ask('2027-02-12 19:00', '19:00')).toBe(false);
  });
});

describe('buildAskMessage', () => {
  it('いつもの文：金額と名前を書かない', () => {
    const m = buildAskMessage({ startDate: '2026-12-14', lastShotOn: '2026-12-20', reviewCount: 3, url: 'https://bw5-app.vercel.app/staff/bw6/bank' });
    expect(m.subject).toBe('入金のスクショをお願いします');
    expect(m.body).toBe('BW6 入金のスクショをお願いします。\n開始日は 12月14日。前に撮ったのは 12月20日。\n見てほしい入金 3件　https://bw5-app.vercel.app/staff/bw6/bank');
    expect(m.body).not.toMatch(/円/);
  });
  it('見てほしい入金が0件ならその行を出さない・前に撮った日が無ければ開始日だけ', () => {
    expect(buildAskMessage({ startDate: '2026-12-14', lastShotOn: null, reviewCount: 0, url: 'u' }).body).toBe('BW6 入金のスクショをお願いします。\n開始日は 12月14日。');
  });
  it('休み明けの文', () => {
    const m = buildAskMessage({ startDate: '2026-12-29', lastShotOn: '2026-12-29', reviewCount: 0, url: 'u', afterRest: true });
    expect(m.subject).toBe('入金のスクショをお願いします（休み明け）');
    expect(m.body).toBe('休みの間の分を、お願いします。\n開始日を 12月29日 にして、まとめて撮ってください。');
  });
});

describe('nowJstOf', () => {
  it('UTC の時刻を JST の YYYY-MM-DD HH:MM に（日をまたぐ）', () => {
    expect(nowJstOf(new Date('2026-12-20T10:00:00Z'))).toBe('2026-12-20 19:00');
    expect(nowJstOf(new Date('2027-01-03T23:00:00Z'))).toBe('2027-01-04 08:00');
  });
});
