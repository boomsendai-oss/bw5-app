import { describe, it, expect } from 'vitest';
import {
  nextKioskStep,
  remainingDivisions,
  phaseForDivision,
  needsPhotoGuide,
  type KioskEntrant,
} from '../bf6Kiosk';

const base = (over: Partial<KioskEntrant> = {}): KioskEntrant => ({
  itemId: 1,
  dancerName: 'AM',
  divisions: ['beginner'],
  paymentStatus: 'paid',
  amountDue: 0,
  drawnDivisions: [],
  ...over,
});

describe('受付の次にやること', () => {
  it('当日現金が未払いなら、まず支払いに案内する', () => {
    const e = base({ paymentStatus: 'cash_due', amountDue: 2500 });
    expect(nextKioskStep(e, 'beginner')).toEqual({ kind: 'pay', amount: 2500 });
  });

  it('支払い済みなら抽選に進む', () => {
    expect(nextKioskStep(base(), 'beginner')).toMatchObject({ kind: 'draw', division: 'beginner' });
  });

  it('その部門の抽選が済んでいたら、もう引かせない(二度引き防止)', () => {
    const e = base({ drawnDivisions: ['beginner'] });
    expect(nextKioskStep(e, 'beginner')).toMatchObject({ kind: 'done' });
  });

  it('2部門に出る人は、片方が済んでももう片方が残る', () => {
    const e = base({ divisions: ['beginner', 'kids'], drawnDivisions: ['beginner'] });
    expect(nextKioskStep(e, 'kids')).toMatchObject({ kind: 'draw', division: 'kids' });
  });

  it('当日現金は部門ごとに払わせない(1回払えば全部門ぶん)', () => {
    const e = base({ divisions: ['beginner', 'kids'], paymentStatus: 'paid', amountDue: 0, drawnDivisions: ['beginner'] });
    expect(nextKioskStep(e, 'kids')).toMatchObject({ kind: 'draw' });
  });
});

describe('残っている部門(ダブルエントリーの続き)', () => {
  it('1部門だけの人は、抽選が済めば残らない', () => {
    expect(remainingDivisions(base({ drawnDivisions: ['beginner'] }))).toEqual([]);
  });

  it('まだ引いていなければ、その部門が残る', () => {
    expect(remainingDivisions(base())).toEqual(['beginner']);
  });

  it('2部門のうち片方が済んでいれば、もう片方を返す', () => {
    const e = base({ divisions: ['beginner', 'kids'], drawnDivisions: ['beginner'] });
    expect(remainingDivisions(e)).toEqual(['kids']);
  });

  it('2部門とも未着手なら両方返す', () => {
    const e = base({ divisions: ['general', 'kids'] });
    expect(remainingDivisions(e)).toEqual(['general', 'kids']);
  });

  it('両方済んでいれば空', () => {
    const e = base({ divisions: ['general', 'kids'], drawnDivisions: ['general', 'kids'] });
    expect(remainingDivisions(e)).toEqual([]);
  });
});

describe('部門ごとの抽選の種類', () => {
  it('ビギナーは受付でトーナメントの位置まで決まる', () => {
    expect(phaseForDivision('beginner')).toBe('bracket');
  });

  it('小中学生と一般は、まず予選のA/Bブロック', () => {
    expect(phaseForDivision('kids')).toBe('block');
    expect(phaseForDivision('general')).toBe('block');
  });
});

describe('写真撮影の案内', () => {
  it('ビギナーは受付の時点で撮る(この後すぐトーナメントに出るため)', () => {
    expect(needsPhotoGuide(['beginner'])).toBe(true);
  });

  it('小中学生・一般は予選後に撮るので、受付では案内しない', () => {
    expect(needsPhotoGuide(['kids'])).toBe(false);
    expect(needsPhotoGuide(['general'])).toBe(false);
  });

  it('ビギナーを含んでいれば案内する', () => {
    expect(needsPhotoGuide(['kids', 'beginner'])).toBe(true);
  });
});
