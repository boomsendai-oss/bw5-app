import { describe, it, expect } from 'vitest';
import { resolveAttendance, isTrialDenominator } from '../trialAttendance';

const TODAY = '2026-07-27';

describe('resolveAttendance', () => {
  it('Lstepでキャンセル済みなら キャンセル', () => {
    const r = resolveAttendance(
      { status: 'キャンセル', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('キャンセル');
  });

  it('人がノーショー訂正していれば ノーショー', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: 'noshow', reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('ノーショー');
  });

  it('キャンセルは訂正より優先する(キャンセル済みをノーショーとは数えない)', () => {
    const r = resolveAttendance(
      { status: 'キャンセル', attendance_override: 'noshow', reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('キャンセル');
  });

  it('過去日の予約はキャンセルでなければ来店みなし', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('来店');
  });

  it('Lstepで来店確認済が打たれていればもちろん来店', () => {
    const r = resolveAttendance(
      { status: '来店確認済', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('来店');
  });

  it('当日の予約はまだ予約済(日が終わるまで来店に数えない)', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026-07-27 19:00:00' },
      TODAY
    );
    expect(r).toBe('予約済');
  });

  it('未来の予約は予約済', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026-08-18 19:00:00' },
      TODAY
    );
    expect(r).toBe('予約済');
  });
});

describe('isTrialDenominator', () => {
  it('来店みなしはCVRの分母に入る', () => {
    expect(
      isTrialDenominator(
        { status: '予約済', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
        TODAY
      )
    ).toBe(true);
  });

  it('キャンセル・ノーショー・未消化の予約は分母に入らない', () => {
    const base = { reserved_at: '2026-07-01 19:00:00' };
    expect(isTrialDenominator({ ...base, status: 'キャンセル', attendance_override: null }, TODAY)).toBe(false);
    expect(isTrialDenominator({ ...base, status: '予約済', attendance_override: 'noshow' }, TODAY)).toBe(false);
    expect(
      isTrialDenominator({ status: '予約済', attendance_override: null, reserved_at: '2026-08-18 19:00:00' }, TODAY)
    ).toBe(false);
  });
});
