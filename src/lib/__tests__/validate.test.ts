import { describe, it, expect } from 'vitest';
import {
  INSTANCE_STATUSES, PAYROLL_STATUS_TRANSITIONS, oneOf, canTransition,
} from '../validate';

describe('oneOf', () => {
  it('許可値を通す', () => {
    expect(oneOf('scheduled', INSTANCE_STATUSES)).toBe(true);
    expect(oneOf('removed', INSTANCE_STATUSES)).toBe(true);
  });
  it('許可外/非文字列を弾く', () => {
    expect(oneOf('休講', INSTANCE_STATUSES)).toBe(false);
    expect(oneOf(1, INSTANCE_STATUSES)).toBe(false);
    expect(oneOf(null, INSTANCE_STATUSES)).toBe(false);
  });
});

describe('canTransition', () => {
  it('正当な遷移を許可', () => {
    expect(canTransition('draft', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'paid')).toBe(true);
    expect(canTransition('confirmed', 'draft')).toBe(true);
  });
  it('paidからの遷移とタイポ経由を拒否', () => {
    expect(canTransition('paid', 'draft')).toBe(false);
    expect(canTransition('draft', 'paid')).toBe(false); // draftから直接paidは不可
    expect(canTransition('unknown', 'draft')).toBe(false);
  });
  it('遷移表は draft/confirmed/paid を網羅', () => {
    expect(Object.keys(PAYROLL_STATUS_TRANSITIONS).sort()).toEqual(['confirmed', 'draft', 'paid']);
  });
});
