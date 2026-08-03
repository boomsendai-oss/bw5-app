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
  validateBf6Order,
  countEntriesByDivision,
  buildBf6OrderItems,
  formatReceiptNo,
  type Bf6OrderInput,
} from '../bf6';

function validInput(): Bf6OrderInput {
  return {
    buyerName: '山田太郎',
    email: 'taro@example.com',
    phone: '090-1234-5678',
    payMethod: 'prepaid',
    entries: [
      {
        performerName: 'ヤマダタロウ',
        dancerName: 'TARO',
        dancerKana: 'タロー',
        grade: 'es4',
        genre: 'HIPHOP',
        rep: 'BOOM',
        instagram: '@taro_dance',
        isFirstBattle: true,
        divisions: ['beginner'],
      },
    ],
    adultTickets: 1,
    childTickets: 0,
  };
}

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

describe('validateBf6Order: 申込入力の検証', () => {
  test('正しい入力はValidatedで返る', () => {
    const v = validateBf6Order(validInput());
    expect(typeof v).not.toBe('string');
    if (typeof v === 'string') return;
    expect(v.buyerName).toBe('山田太郎');
    expect(v.entries[0].dancerName).toBe('TARO');
    expect(v.entries[0].divisions).toEqual(['beginner']);
  });

  test('申込者氏名・電話・メールは必須', () => {
    expect(typeof validateBf6Order({ ...validInput(), buyerName: ' ' })).toBe('string');
    expect(typeof validateBf6Order({ ...validInput(), phone: '' })).toBe('string');
    expect(typeof validateBf6Order({ ...validInput(), email: 'not-an-email' })).toBe('string');
  });

  test('電話番号は数字10〜11桁(ハイフン許容)', () => {
    expect(typeof validateBf6Order({ ...validInput(), phone: '09012345678' })).not.toBe('string');
    expect(typeof validateBf6Order({ ...validInput(), phone: '123' })).toBe('string');
    expect(typeof validateBf6Order({ ...validInput(), phone: 'でんわ' })).toBe('string');
  });

  test('本名はカタカナ必須', () => {
    const input = validInput();
    input.entries[0].performerName = '山田太郎';
    expect(typeof validateBf6Order(input)).toBe('string');
  });

  test('ダンサーネーム・フリガナは必須', () => {
    const a = validInput();
    a.entries[0].dancerName = '';
    expect(typeof validateBf6Order(a)).toBe('string');
    const b = validInput();
    b.entries[0].dancerKana = '';
    expect(typeof validateBf6Order(b)).toBe('string');
  });

  test('エントリージャンル・レペゼンは必須(TARO 2026-08-04)', () => {
    const a = validInput();
    a.entries[0].genre = '';
    expect(typeof validateBf6Order(a)).toBe('string');
    const b = validInput();
    b.entries[0].rep = ' ';
    expect(typeof validateBf6Order(b)).toBe('string');
  });

  test('初心者部門は小学生+初出場でないとエラー', () => {
    const notFirst = validInput();
    notFirst.entries[0].isFirstBattle = false;
    expect(typeof validateBf6Order(notFirst)).toBe('string');
    const adult = validInput();
    adult.entries[0].grade = 'adult';
    expect(typeof validateBf6Order(adult)).toBe('string');
  });

  test('小中学生部門は小中学生のみ', () => {
    const input = validInput();
    input.entries[0] = { ...input.entries[0], grade: 'adult', isFirstBattle: false, divisions: ['kids'] };
    expect(typeof validateBf6Order(input)).toBe('string');
    input.entries[0] = { ...input.entries[0], grade: 'jhs3' };
    expect(typeof validateBf6Order(input)).not.toBe('string');
  });

  test('一般部門は学年制限なし', () => {
    const input = validInput();
    input.entries[0] = { ...input.entries[0], grade: 'es3', isFirstBattle: false, divisions: ['general'] };
    expect(typeof validateBf6Order(input)).not.toBe('string');
  });

  test('部門の重複は除去・未知の部門はエラー', () => {
    const dup = validInput();
    dup.entries[0].divisions = ['beginner', 'beginner'];
    const v = validateBf6Order(dup);
    if (typeof v === 'string') throw new Error(v);
    expect(v.entries[0].divisions).toEqual(['beginner']);
    const bad = validInput();
    bad.entries[0].divisions = ['pro'];
    expect(typeof validateBf6Order(bad)).toBe('string');
  });

  test('Instagramは@を補って正規化・空はそのまま', () => {
    const noAt = validInput();
    noAt.entries[0].instagram = 'boom.dance';
    const v = validateBf6Order(noAt);
    if (typeof v === 'string') throw new Error(v);
    expect(v.entries[0].instagram).toBe('@boom.dance');
    const empty = validInput();
    empty.entries[0].instagram = '';
    const v2 = validateBf6Order(empty);
    if (typeof v2 === 'string') throw new Error(v2);
    expect(v2.entries[0].instagram).toBe('');
  });

  test('出場者0人でも観覧枚数があれば通る(観覧のみ購入)', () => {
    const v = validateBf6Order({ ...validInput(), entries: [], adultTickets: 2, childTickets: 0 });
    expect(typeof v).not.toBe('string');
  });

  test('出場者0人かつ観覧0枚はエラー', () => {
    expect(typeof validateBf6Order({ ...validInput(), entries: [], adultTickets: 0, childTickets: 0 })).toBe('string');
  });

  test('観覧枚数は0〜20の整数のみ', () => {
    expect(typeof validateBf6Order({ ...validInput(), adultTickets: -1 })).toBe('string');
    expect(typeof validateBf6Order({ ...validInput(), adultTickets: 21 })).toBe('string');
    expect(typeof validateBf6Order({ ...validInput(), adultTickets: 1.5 })).toBe('string');
  });

  test('支払方法はprepaid/onsiteのみ', () => {
    expect(typeof validateBf6Order({ ...validInput(), payMethod: 'bitcoin' })).toBe('string');
  });
});

describe('countEntriesByDivision', () => {
  test('部門ごとの人数を数える', () => {
    const counts = countEntriesByDivision([
      { divisions: ['beginner'] },
      { divisions: ['kids', 'general'] },
      { divisions: ['general'] },
    ]);
    expect(counts).toEqual({ beginner: 1, kids: 1, general: 2 });
  });
});

describe('buildBf6OrderItems: 明細行の生成(単価はサーバ側で確定)', () => {
  test('エントリー2人+観覧を明細化し、合計がcalcOrderTotalと一致する', () => {
    const input = validInput();
    input.entries.push({
      performerName: 'ヤマダジロウ',
      dancerName: 'JIRO',
      dancerKana: 'ジロー',
      grade: 'jhs1',
      genre: 'BREAK',
      rep: 'BOOM',
      instagram: '',
      isFirstBattle: false,
      divisions: ['kids', 'general'],
    });
    input.childTickets = 2;
    const v = validateBf6Order(input);
    if (typeof v === 'string') throw new Error(v);
    const items = buildBf6OrderItems(v, 'prepaid');
    const entryItems = items.filter((i) => i.itemType === 'entry');
    expect(entryItems).toHaveLength(2);
    expect(entryItems[0].unitAmount).toBe(2000);
    expect(entryItems[1].unitAmount).toBe(3500);
    const adult = items.find((i) => i.itemType === 'ticket_adult');
    expect(adult).toMatchObject({ qty: 1, unitAmount: 2000 });
    const child = items.find((i) => i.itemType === 'ticket_child');
    expect(child).toMatchObject({ qty: 2, unitAmount: 1000 });
    const total = items.reduce((s, i) => s + i.qty * i.unitAmount, 0);
    expect(total).toBe(
      calcOrderTotal(
        { entries: v.entries.map((e) => ({ divisions: e.divisions })), adultTickets: 1, childTickets: 2 },
        'prepaid'
      )
    );
  });

  test('観覧0枚の明細は作らない', () => {
    const v = validateBf6Order({ ...validInput(), adultTickets: 0, childTickets: 0 });
    if (typeof v === 'string') throw new Error(v);
    const items = buildBf6OrderItems(v, 'onsite');
    expect(items.every((i) => i.itemType === 'entry')).toBe(true);
  });
});

describe('formatReceiptNo', () => {
  test('BF6-連番3桁', () => {
    expect(formatReceiptNo(7)).toBe('BF6-007');
    expect(formatReceiptNo(123)).toBe('BF6-123');
    expect(formatReceiptNo(1234)).toBe('BF6-1234');
  });
});
