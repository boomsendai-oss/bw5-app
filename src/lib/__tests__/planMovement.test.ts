import { describe, it, expect } from 'vitest';
import { normalizePlanName } from '../weeklyMetrics';

describe('normalizePlanName', () => {
  it('HACOMONOの商品名からプラン名を取り出す', () => {
    expect(normalizePlanName('マンスリーレギュラー / 受け放題（90分） 月会費 (202609)x1')).toBe('受け放題');
    expect(normalizePlanName('マンスリーレギュラー / 月謝4回(60分) 月会費 (2026年9月)x1')).toBe('60分4回');
    expect(normalizePlanName('マンスリーレギュラー / 月謝8回(90分) 月会費 (202609)x1')).toBe('90分8回');
    expect(normalizePlanName('マンスリーカレッジ学割 / 月謝4回(90分) 月会費 (202609)x1')).toBe('カレッジ');
  });
  it('チケット会員・休会・管理者は月謝プランに数えない', () => {
    expect(normalizePlanName('チケット会員 月会費 (202609)x1')).toBeNull();
    expect(normalizePlanName('休会 月会費 (202609)x1')).toBeNull();
    expect(normalizePlanName('管理者プラン 月会費 (202609)x1')).toBeNull();
  });
});
