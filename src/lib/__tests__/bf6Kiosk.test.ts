import { describe, it, expect } from 'vitest';
import {
  nextKioskStep,
  remainingDivisions,
  phaseForEntrant,
  isDrawnFor,
  needsPhotoGuideAfterDraw,
  type KioskEntrant,
} from '../bf6Kiosk';

const base = (over: Partial<KioskEntrant> = {}): KioskEntrant => ({
  itemId: 1,
  dancerName: 'AM',
  divisions: ['beginner'],
  paymentStatus: 'paid',
  amountDue: 0,
  draws: [],
  qualifierDivisions: [],
  ...over,
});

describe('その人がいま引くくじの種類', () => {
  it('ビギナーは受付でトーナメントの位置まで決まる', () => {
    expect(phaseForEntrant(base(), 'beginner')).toBe('bracket');
  });
  it('小中学生・一般は、まず予選のA/Bブロック', () => {
    expect(phaseForEntrant(base({ divisions: ['kids'] }), 'kids')).toBe('block');
  });
  it('予選通過者に登録されたら、ベスト8の位置を引く(くじ引き②)', () => {
    const e = base({ divisions: ['kids'], qualifierDivisions: ['kids'] });
    expect(phaseForEntrant(e, 'kids')).toBe('bracket');
  });
});

describe('受付の次にやること', () => {
  it('当日現金が未払いなら、まず支払いに案内する', () => {
    expect(nextKioskStep(base({ paymentStatus: 'cash_due', amountDue: 2500 }), 'beginner')).toEqual({
      kind: 'pay',
      amount: 2500,
    });
  });
  it('支払い済みなら抽選に進む', () => {
    expect(nextKioskStep(base(), 'beginner')).toMatchObject({ kind: 'draw', phase: 'bracket' });
  });
  it('その部門の抽選が済んでいたら、もう引かせない', () => {
    const e = base({ draws: [{ division: 'beginner', phase: 'bracket' }] });
    expect(nextKioskStep(e, 'beginner')).toMatchObject({ kind: 'done' });
  });
  it('予選通過者は、ブロックを引き終えていてもベスト8のくじに進む', () => {
    const e = base({
      divisions: ['kids'],
      qualifierDivisions: ['kids'],
      draws: [{ division: 'kids', phase: 'block' }],
    });
    expect(nextKioskStep(e, 'kids')).toMatchObject({ kind: 'draw', phase: 'bracket' });
  });
  it('ベスト8のくじも済んでいたら、もう引かせない', () => {
    const e = base({
      divisions: ['kids'],
      qualifierDivisions: ['kids'],
      draws: [
        { division: 'kids', phase: 'block' },
        { division: 'kids', phase: 'bracket' },
      ],
    });
    expect(nextKioskStep(e, 'kids')).toMatchObject({ kind: 'done' });
  });
});

describe('引き済みかどうか', () => {
  it('いま引くべき種類のくじを引いていれば済み', () => {
    const e = base({ draws: [{ division: 'beginner', phase: 'bracket' }] });
    expect(isDrawnFor(e, 'beginner')).toBe(true);
  });
  it('種類が違えばまだ(通過者のブロックだけ引いた状態)', () => {
    const e = base({ divisions: ['kids'], qualifierDivisions: ['kids'], draws: [{ division: 'kids', phase: 'block' }] });
    expect(isDrawnFor(e, 'kids')).toBe(false);
  });
});

describe('残っている部門(ダブルエントリーの続き)', () => {
  it('1部門だけの人は、抽選が済めば残らない', () => {
    expect(remainingDivisions(base({ draws: [{ division: 'beginner', phase: 'bracket' }] }))).toEqual([]);
  });
  it('2部門のうち片方が済んでいれば、もう片方を返す', () => {
    const e = base({ divisions: ['beginner', 'kids'], draws: [{ division: 'beginner', phase: 'bracket' }] });
    expect(remainingDivisions(e)).toEqual(['kids']);
  });
  it('2部門とも未着手なら両方返す', () => {
    expect(remainingDivisions(base({ divisions: ['general', 'kids'] }))).toEqual(['general', 'kids']);
  });
});

describe('写真撮影の案内', () => {
  // ビギナーは受付の直後、小中・一般はベスト8のくじの直後に撮る
  it('ビギナーは受付の抽選のあとに案内する', () => {
    expect(needsPhotoGuideAfterDraw('beginner', 'bracket')).toBe(true);
  });
  it('小中学生のブロック抽選のあとには案内しない', () => {
    expect(needsPhotoGuideAfterDraw('kids', 'block')).toBe(false);
  });
  it('小中学生・一般はベスト8のくじのあとに案内する', () => {
    expect(needsPhotoGuideAfterDraw('kids', 'bracket')).toBe(true);
    expect(needsPhotoGuideAfterDraw('general', 'bracket')).toBe(true);
  });
});
