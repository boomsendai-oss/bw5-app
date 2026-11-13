import { describe, it, expect } from 'vitest';
import {
  isGiftEligibleProduct,
  decideNewClaims,
  normalizeSize,
  normalizeColor,
  buildOrderSheet,
  renderOrderSheetMarkdown,
  ITEM_ADULT,
  ITEM_KIDS,
  type BillingCandidate,
} from '../giftTshirt';
import { isMissingTableError } from '../giftTshirtDb';

const GIFT = '月謝 / キッズ週1 月会費, 入会金x1, クーポン割引 (入会金), クーポン割引 (キッズ週1 月会費)';
const TICKET = 'チケット会員 / 4回券, 入会金x1, クーポン割引 (入会金)';
const b = (o: Partial<BillingCandidate>): BillingCandidate => ({
  billing_record_id: 1, billing_date: '2026-11-05', boom_member_id: 10, product_name: GIFT, status: '確定', line_linked: true, ...o,
});

describe('isGiftEligibleProduct', () => {
  it('入会金+両方のクーポン割引=対象', () => expect(isGiftEligibleProduct(GIFT)).toBe(true));
  it('チケット会員・月会費の割引なし・空は対象外', () => {
    expect(isGiftEligibleProduct(TICKET)).toBe(false);
    expect(isGiftEligibleProduct(GIFT + ', チケット会員')).toBe(false);
    expect(isGiftEligibleProduct('月謝 / 週1, 入会金x1, クーポン割引 (入会金)')).toBe(false);
    expect(isGiftEligibleProduct(null)).toBe(false);
  });
  it('本番の請求の書式(プラン名に括弧入り)でも対象と判定する', () => {
    const real =
      'マンスリーレギュラー / 月謝4回(60分) 初月会費 (2026年11月 日割り11日分)x1, マンスリーレギュラー / 月謝4回(60分) 月会費 (2026年12月)x1, 入会金x1, クーポン割引 (入会金)x1, クーポン割引 (マンスリーレギュラー / 月謝4回(60分) 月会費 (2026年12月))x1';
    expect(isGiftEligibleProduct(real)).toBe(true);
    // 月会費の割引が無い(2週間を過ぎた入会)は対象外
    const noMonthly = 'マンスリーレギュラー / 月謝4回(60分) 初月会費 (2026年5月 日割り18日分)x1, マンスリーレギュラー / 月謝4回(60分) 月会費 (2026年6月)x1, 入会金x1';
    expect(isGiftEligibleProduct(noMonthly)).toBe(false);
    // チケット会員の書式は対象外
    const ticket = 'チケット会員 初月会費 (2026年11月 日割り22日分)x1, チケット会員 月会費 (2026年12月)x1, 入会金x1, クーポン割引 (入会金)x1';
    expect(isGiftEligibleProduct(ticket)).toBe(false);
  });
});

describe('decideNewClaims', () => {
  it('11/1以降の該当だけ・LINEなしは no_line', () => {
    const r = decideNewClaims(
      [b({}), b({ billing_record_id: 2, boom_member_id: 11, line_linked: false }), b({ billing_record_id: 3, boom_member_id: 12, billing_date: '2026-10-31' })],
      new Set(),
    );
    expect(r.claims).toEqual([
      { boom_member_id: 10, billing_record_id: 1, enrolled_on: '2026-11-05', status: 'invite_pending', line_linked: 1 },
      { boom_member_id: 11, billing_record_id: 2, enrolled_on: '2026-11-05', status: 'no_line', line_linked: 0 },
    ]);
  });
  it('既に台帳にいる会員・同じ会員の2回目・チケット会員・キャンセルは足さない', () => {
    const r = decideNewClaims(
      [
        b({ boom_member_id: 5 }),
        b({ billing_record_id: 2, billing_date: '2026-11-03' }),
        b({ billing_record_id: 3, billing_date: '2026-11-09' }),
        b({ billing_record_id: 4, boom_member_id: 20, product_name: TICKET }),
        b({ billing_record_id: 5, boom_member_id: 21, status: 'キャンセル' }),
      ],
      new Set([5]),
    );
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({ boom_member_id: 10, billing_record_id: 2, enrolled_on: '2026-11-03' });
  });
  it('会員と紐付いていない該当は数だけ', () => {
    const r = decideNewClaims([b({ boom_member_id: null })], new Set());
    expect(r).toEqual({ claims: [], unlinked: 1 });
  });
});

describe('normalizeSize / normalizeColor', () => {
  it('アンケートの書き方の揺れをそろえる', () => {
    expect(normalizeSize('キッズ110')).toBe('110');
    expect(normalizeSize('大人XXL')).toBe('XXL');
    expect(normalizeSize('ｍ')).toBe('M');
    expect(normalizeSize('130cm')).toBe('130');
    expect(normalizeSize('100')).toBeNull();
    expect(normalizeColor('ﾗｲﾄﾌﾞﾙｰ')).toBe('ライトブルー');
    expect(normalizeColor('ミックスグレイ')).toBe('ミックスグレー');
    expect(normalizeColor('オレンジ')).toBeNull();
  });
});

describe('buildOrderSheet', () => {
  it('品番×色×サイズで数える・読めない回答は数えない', () => {
    const s = buildOrderSheet([
      { id: 1, color: 'ネイビー', size: '大人M' },
      { id: 2, color: 'ネイビー', size: 'M' },
      { id: 3, color: 'ホワイト', size: 'キッズ130' },
      { id: 4, color: 'ネイビー', size: 'キッズ110' },
      { id: 5, color: 'オレンジ', size: 'M' },
    ]);
    expect(s.total).toBe(4);
    expect(s.lines).toEqual([
      { item: ITEM_ADULT, color: 'ネイビー', size: 'M', qty: 2, claim_ids: [1, 2] },
      { item: ITEM_KIDS, color: 'ホワイト', size: '130', qty: 1, claim_ids: [3] },
      { item: ITEM_KIDS, color: 'ネイビー', size: '110', qty: 1, claim_ids: [4] },
    ]);
    expect(s.unreadable).toEqual([{ id: 5, color: 'オレンジ', size: 'M' }]);
    const md = renderOrderSheetMarkdown(s, '2026-11-16');
    expect(md).toContain('合計 **4枚**');
    expect(md).toContain('| United Athle 5001-02 | ホワイト | キッズ130 | 1 | 3 |');
    expect(md).toContain('読めない回答 1件');
  });
  it('0枚の週', () => {
    const s = buildOrderSheet([]);
    expect(s.total).toBe(0);
    expect(renderOrderSheetMarkdown(s, '2026-11-16')).toContain('0枚');
  });
});

describe('isMissingTableError', () => {
  it('台帳テーブル未作成だけを拾う', () => {
    expect(isMissingTableError(new Error('SQLITE_ERROR: no such table: gift_tshirt_claims'))).toBe(true);
    expect(isMissingTableError(new Error('no such table: boom_members'))).toBe(false);
  });
});
