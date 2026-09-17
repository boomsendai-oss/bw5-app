import { describe, it, expect } from 'vitest';
import {
  normalizePin,
  isValidPinFormat,
  crewSessionExpiry,
  CREW_TASKS,
  CREW_SESSION_DAYS,
} from '../bf6Crew';

describe('PINの正規化', () => {
  it('全角数字を半角に直す(iPadのキーボードで混ざる)', () => {
    expect(normalizePin('１２３４')).toBe('1234');
  });

  it('空白とハイフンは無視する', () => {
    expect(normalizePin('12 34')).toBe('1234');
    expect(normalizePin('12-34')).toBe('1234');
    expect(normalizePin('12ー34')).toBe('1234');
  });

  it('普通に打てばそのまま', () => {
    expect(normalizePin('4726')).toBe('4726');
  });
});

describe('PINの形式', () => {
  it('4〜8桁の数字なら通す', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('12345678')).toBe(true);
  });

  it('短すぎ・長すぎは弾く', () => {
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('123456789')).toBe(false);
  });

  it('数字以外は弾く(当日iPadで打つので記号は入れさせない)', () => {
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
  });
});

describe('セッションの期限', () => {
  it('イベント前後だけ有効にする(PINが漏れても長く残さない)', () => {
    const now = new Date('2026-09-26T00:00:00.000Z');
    const exp = new Date(crewSessionExpiry(now));
    const days = (exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(CREW_SESSION_DAYS);
  });
});

describe('クルーが触れる作業', () => {
  // 並びは当日やる順番。受付で引いた人からそのまま撮影へ回すので、
  // 受付のすぐ下が写真撮影(TARO実機 2026-09-16)。
  it('当日オペだけを、当日やる順番で並べる', () => {
    expect(CREW_TASKS.map((t) => t.title)).toEqual([
      'バトルエントリー受付・くじ引き①',
      '写真撮影',
      '当日現金の集金',
      '入場受付(観覧)',
      'ブロック予選',
      '小中・一般 くじ引き②',
      'LED操作卓',
    ]);
  });

  it('返金・台帳・会員データへは行かせない(すべて /bf6/crew 配下)', () => {
    for (const t of CREW_TASKS) {
      expect(t.href.startsWith('/bf6/crew/')).toBe(true);
    }
  });
});
