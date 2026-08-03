import { describe, expect, test } from 'vitest';
import {
  DEFAULT_BF6_SETTINGS,
  calcEntryFee,
  calcTicketUnitPrice,
  calcOrderTotal,
  canEnterBeginner,
  isElementaryGrade,
  divisionRemaining,
  ticketRemaining,
} from '../bf6';

describe('calcEntryFee: バトルエントリー料金(部門数と支払方法で決まる)', () => {
  test('1部門・当日現金は¥2,500', () => {
    expect(calcEntryFee(1, 'onsite')).toBe(2500);
  });

  test('2部門・当日現金は¥4,000', () => {
    expect(calcEntryFee(2, 'onsite')).toBe(4000);
  });

  test('3部門・当日現金は¥5,500', () => {
    expect(calcEntryFee(3, 'onsite')).toBe(5500);
  });

  test('事前決済は一律¥500引き(1部門¥2,000・2部門¥3,500・3部門¥5,000)', () => {
    expect(calcEntryFee(1, 'prepaid')).toBe(2000);
    expect(calcEntryFee(2, 'prepaid')).toBe(3500);
    expect(calcEntryFee(3, 'prepaid')).toBe(5000);
  });

  test('0部門は0円(エラーにせずUI側で無効化)', () => {
    expect(calcEntryFee(0, 'prepaid')).toBe(0);
    expect(calcEntryFee(0, 'onsite')).toBe(0);
  });

  test('スタッフ設定で料金を上書きできる', () => {
    const pricing = {
      ...DEFAULT_BF6_SETTINGS.pricing,
      entryBase: 3000,
      entryPerExtraDivision: 1000,
      prepaidDiscount: 300,
    };
    expect(calcEntryFee(2, 'onsite', pricing)).toBe(4000);
    expect(calcEntryFee(2, 'prepaid', pricing)).toBe(3700);
  });
});

describe('calcTicketUnitPrice: 観覧チケット単価', () => {
  test('大人は事前¥2,000・当日¥2,500', () => {
    expect(calcTicketUnitPrice('ticket_adult', 'prepaid')).toBe(2000);
    expect(calcTicketUnitPrice('ticket_adult', 'onsite')).toBe(2500);
  });

  test('小学生は事前・当日とも¥1,000', () => {
    expect(calcTicketUnitPrice('ticket_child', 'prepaid')).toBe(1000);
    expect(calcTicketUnitPrice('ticket_child', 'onsite')).toBe(1000);
  });
});

describe('calcOrderTotal: カート合計(エントリー複数人+観覧同時購入)', () => {
  test('兄弟2人(1部門+2部門)+大人2枚+小学生1枚を事前決済', () => {
    const total = calcOrderTotal(
      {
        entries: [{ divisions: ['beginner'] }, { divisions: ['kids', 'general'] }],
        adultTickets: 2,
        childTickets: 1,
      },
      'prepaid'
    );
    expect(total).toBe(2000 + 3500 + 2000 * 2 + 1000);
  });

  test('観覧のみ・当日現金', () => {
    const total = calcOrderTotal(
      { entries: [], adultTickets: 1, childTickets: 2 },
      'onsite'
    );
    expect(total).toBe(2500 + 1000 * 2);
  });

  test('空カートは0円', () => {
    expect(calcOrderTotal({ entries: [], adultTickets: 0, childTickets: 0 }, 'prepaid')).toBe(0);
  });
});

describe('canEnterBeginner: 初心者部門の資格 = 小学生かつバトル初出場', () => {
  test('小1〜小6かつ初出場ならOK', () => {
    expect(canEnterBeginner('es1', true)).toBe(true);
    expect(canEnterBeginner('es6', true)).toBe(true);
  });

  test('小学生でも初出場でなければNG', () => {
    expect(canEnterBeginner('es3', false)).toBe(false);
  });

  test('中学生以上は初出場でもNG', () => {
    expect(canEnterBeginner('jhs1', true)).toBe(false);
    expect(canEnterBeginner('adult', true)).toBe(false);
  });

  test('未就学児はNG', () => {
    expect(canEnterBeginner('preschool', true)).toBe(false);
  });
});

describe('isElementaryGrade', () => {
  test('es1〜es6のみtrue', () => {
    expect(isElementaryGrade('es1')).toBe(true);
    expect(isElementaryGrade('es6')).toBe(true);
    expect(isElementaryGrade('preschool')).toBe(false);
    expect(isElementaryGrade('jhs3')).toBe(false);
    expect(isElementaryGrade('adult')).toBe(false);
  });
});

describe('divisionRemaining: 部門ごとの残枠', () => {
  test('定員16で確定12なら残4', () => {
    expect(divisionRemaining(16, 12)).toBe(4);
  });

  test('定員超過しても0未満にならない', () => {
    expect(divisionRemaining(16, 20)).toBe(0);
  });
});

describe('ticketRemaining: 観覧残数 = ホール定員200 − 出演者数 − 販売済', () => {
  test('出演者50・販売済30なら残120', () => {
    expect(ticketRemaining(200, 50, 30)).toBe(120);
  });

  test('マイナスにはならない', () => {
    expect(ticketRemaining(200, 150, 60)).toBe(0);
  });
});
