import { describe, it, expect } from 'vitest';
import { extractApprovalNo, isDebitRefund, planRefunds, type ChargeRef, type RefundRow } from '../expenseRefunds';

describe('extractApprovalNo', () => {
  it('全角コロンでも半角でも取れる', () => {
    expect(extractApprovalNo('Visaデビット取消 INSTABASE 承認番号：404078 TID：586170091482641')).toBe('404078');
    expect(extractApprovalNo('Visaデビット利用 INSTABASE 承認番号:404078')).toBe('404078');
  });
  it('承認番号が無ければ null', () => {
    expect(extractApprovalNo('振込  ジ－エムオ－イプシロン（カ')).toBeNull();
  });
});

describe('isDebitRefund', () => {
  it('利用の取消は返金', () => {
    expect(isDebitRefund('Visaデビット取消 INSTABASE 承認番号：404078', 5775)).toBe(true);
    expect(isDebitRefund('Visaデビット出金取消 UBER * PENDING 承認番号：447047', 92)).toBe(true);
  });
  it('入金取消は「返金の取り消し」なので対象外', () => {
    // これを返金扱いにすると符号が逆になり、経費が二重に減る
    expect(isDebitRefund('Visaデビット入金取消 UBER * PENDING 承認番号：403709', 168)).toBe(false);
  });
  it('出金行は返金ではない', () => {
    expect(isDebitRefund('Visaデビット利用 INSTABASE 承認番号：404078', -5775)).toBe(false);
  });
});

describe('planRefunds', () => {
  const charge = (o: Partial<ChargeRef>): ChargeRef => ({
    txnId: 1, approvalNo: '404078', category: '会場費', subcategory: 'インスタベース', amount: 5775, ...o,
  });
  const refund = (o: Partial<RefundRow>): RefundRow => ({
    txnId: 9, date: '2026-06-19', description: 'Visaデビット取消 INSTABASE 承認番号：404078', amount: 5775, ...o,
  });

  it('承認番号が一致する元の経費をマイナスで打ち消す', () => {
    const { plans } = planRefunds([refund({})], new Map([['404078', charge({})]]), new Set());
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ category: '会場費', subcategory: 'インスタベース', amount: -5775 });
  });

  it('元の経費が無い返金は対象外 (打ち消す先がない)', () => {
    const { plans, unmatched } = planRefunds([refund({ description: 'Visaデビット取消 UBER 承認番号：999999' })], new Map(), new Set());
    expect(plans).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });

  it('すでに打ち消し済みならスキップ (冪等)', () => {
    const { plans } = planRefunds([refund({})], new Map([['404078', charge({})]]), new Set(['404078']));
    expect(plans).toHaveLength(0);
  });

  it('返金額が元の経費を超えても、元の額までしか打ち消さない', () => {
    const { plans } = planRefunds([refund({ amount: 9999 })], new Map([['404078', charge({ amount: 5775 })]]), new Set());
    expect(plans[0].amount).toBe(-5775);
  });
});
