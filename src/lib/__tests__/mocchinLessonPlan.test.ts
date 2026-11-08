import { describe, expect, it } from 'vitest';
import {
  MOCCHIN_MARK_PLAN_INVITE,
  MOCCHIN_MARK_PLAN_REMIND,
  buildMocchinCardPaidEmail,
  buildMocchinEmail,
  buildMocchinPlanEmail,
  mocchinNeedsLessonPlan,
  mocchinPaySteps,
  mocchinPlanMailToday,
  mocchinRemindSteps,
} from '../mocchinEntry';

// 2026-11-08 TARO: 申込時は参加費だけ。締切後にレッスン代の払い方を選んでもらう
describe('参加費だけの申込(pending)', () => {
  it('申込時の支払いは参加費15,000円の1回だけ', () => {
    const s = mocchinPaySteps('pending', true, '2026-11-08');
    expect(s).toEqual([{ step: 0, label: '参加費', amount: 15000, due: '2026-11-15' }]);
  });

  it('参加費を払うまでは払い方を選べない', () => {
    expect(mocchinNeedsLessonPlan({ paymentPlan: 'pending', paid: false })).toBe(false);
    expect(mocchinNeedsLessonPlan({ paymentPlan: 'pending', paid: true })).toBe(true);
    expect(mocchinNeedsLessonPlan({ paymentPlan: 'lesson_two', paid: true })).toBe(false);
  });

  it('案内メールは12/14から、参加費を払った人に1回', () => {
    const e = { paymentPlan: 'pending', paid: true, reminded: '' };
    expect(mocchinPlanMailToday(e, '2026-12-13')).toBeNull();
    expect(mocchinPlanMailToday(e, '2026-12-14')).toBe('invite');
    expect(mocchinPlanMailToday({ ...e, paid: false }, '2026-12-14')).toBeNull();
    expect(mocchinPlanMailToday({ ...e, reminded: String(MOCCHIN_MARK_PLAN_INVITE) }, '2026-12-20')).toBeNull();
  });

  it('選ぶ期限(12/27)の3日前から、まだ選んでいない人に1回だけお知らせ', () => {
    const e = { paymentPlan: 'pending', paid: true, reminded: String(MOCCHIN_MARK_PLAN_INVITE) };
    expect(mocchinPlanMailToday(e, '2026-12-23')).toBeNull();
    expect(mocchinPlanMailToday(e, '2026-12-24')).toBe('remind');
    expect(mocchinPlanMailToday({ ...e, reminded: `${MOCCHIN_MARK_PLAN_INVITE},${MOCCHIN_MARK_PLAN_REMIND}` }, '2026-12-25')).toBeNull();
    expect(mocchinPlanMailToday({ ...e, paymentPlan: 'lesson_once' }, '2026-12-24')).toBeNull();
  });

  it('払い方の印(90・91)は支払いのお知らせとぶつからない', () => {
    const e = { paymentPlan: 'lesson_two', isMember: true, appliedOn: '2026-11-08', paid: true, lessonPaid: '', reminded: '90,91' };
    expect(mocchinRemindSteps(e, '2027-01-08').map((s) => s.step)).toEqual([1]);
  });

  it('申込メールに「参加費だけ」と、レッスン代の決め方が書かれる', () => {
    const m = buildMocchinEmail({ id: 1, name: 'テスト', appliedOn: '2026-11-08', isMember: true, paymentPlan: 'pending', payMethod: 'transfer', payToken: 't', overCapacity: false });
    expect(m.text).toContain('申込のときは参加費だけです');
    expect(m.text).toContain('・参加費: 15,000円');
    expect(m.text).toContain('12月14日(月)にメールでご案内します');
    expect(m.text).not.toContain('レッスン代 1回目');
  });

  it('参加費をカードで払ったあとのメールは「すべて完了」と言わない', () => {
    const step = mocchinPaySteps('pending', true, '2026-11-08')[0];
    const m = buildMocchinCardPaidEmail({ id: 1, name: 'テスト', payToken: 't', step, remaining: [], paymentPlan: 'pending' });
    expect(m.text).not.toContain('すべて完了');
    expect(m.text).toContain('【レッスン代について】');
  });

  it('払い方の案内メールに3つの払い方と選ぶページが出る(会員以外は7,000円×6日)', () => {
    const m = buildMocchinPlanEmail({ id: 3, name: 'テスト', payToken: 'abc', isMember: false, kind: 'invite' });
    expect(m.text).toContain('一括(1回): 42,000円(1月10日(日)まで)');
    expect(m.text).toContain('3回に分ける: 14,000円(1月10日(日)まで) / 14,000円(2月10日(水)まで) / 14,000円(3月1日(月)まで)');
    expect(m.text).toContain('/mocchin/pay?t=abc');
    expect(m.subject).toContain('MC-003');
  });
});
