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

  it('キャンセル以外のstatusは中身によらず来店(来店確認済も同じ扱い)', () => {
    const r = resolveAttendance(
      { status: '来店確認済', attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
      TODAY
    );
    expect(r).toBe('来店');
  });

  it('statusがnullでも過去日ならキャンセルでない限り来店', () => {
    const r = resolveAttendance(
      { status: null, attendance_override: null, reserved_at: '2026-07-01 19:00:00' },
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

  it('人の訂正はカレンダーより優先される(未来日でもnoshow指定を尊重する)', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: 'noshow', reserved_at: '2026-08-18 19:00:00' },
      TODAY
    );
    expect(r).toBe('ノーショー');
  });

  it('reserved_atが非ゼロ埋め(月/日が1桁)だとfail closedで予約済のまま', () => {
    // parseDateTime(csvUtil.ts)はゼロ埋めしないため '2026-7-1' のような値が実際に入り得る。
    // 辞書順比較だと '2026-7-1' > '2026-07-27' 扱いになり来店に昇格しない=安全側に倒れることを確認する。
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026-7-1 19:00:00' },
      TODAY
    );
    expect(r).toBe('予約済');
    expect(isTrialDenominator({ status: '予約済', attendance_override: null, reserved_at: '2026-7-1 19:00:00' }, TODAY)).toBe(false);
  });

  it('reserved_atが欠損/切り詰められている場合もfail closedで予約済のまま', () => {
    // '2026' のような値は辞書順比較だと常に「過去日」扱いになってしまう(過大計上のリスク)ため、
    // 形式チェックで弾いて '予約済'(=集計対象外)に倒す。
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '2026' },
      TODAY
    );
    expect(r).toBe('予約済');
    expect(isTrialDenominator({ status: '予約済', attendance_override: null, reserved_at: '2026' }, TODAY)).toBe(false);
  });

  it('reserved_atが空文字でもfail closedで予約済のまま', () => {
    const r = resolveAttendance(
      { status: '予約済', attendance_override: null, reserved_at: '' },
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
