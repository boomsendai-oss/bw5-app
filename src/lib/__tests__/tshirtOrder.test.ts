import { describe, it, expect } from 'vitest';
import {
  TSHIRT_SIZES,
  isTshirtSize,
  validateOrderInput,
  calcOrderTotal,
  defaultTshirtSettings,
} from '../tshirtOrder';

const S = defaultTshirtSettings();

describe('isTshirtSize', () => {
  it('S/M/L/XL/2XL だけ true（キッズサイズは無い）', () => {
    expect(TSHIRT_SIZES).toEqual(['S', 'M', 'L', 'XL', '2XL']);
    for (const s of TSHIRT_SIZES) expect(isTshirtSize(s)).toBe(true);
    expect(isTshirtSize('130')).toBe(false);
    expect(isTshirtSize('3XL')).toBe(false);
    expect(isTshirtSize('')).toBe(false);
    expect(isTshirtSize(null)).toBe(false);
  });
});

describe('validateOrderInput', () => {
  const base = { name: ' 木村 ', size: 'L', qty: 2, wantsShipping: false, email: 't@example.com' };

  it('正常系: 名前をtrimして返す', () => {
    const r = validateOrderInput(base);
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    expect(r.name).toBe('木村');
    expect(r.size).toBe('L');
    expect(r.qty).toBe(2);
    expect(r.wantsShipping).toBe(false);
  });

  it('郵送を希望しない場合、住所・電話は保存しない（PII最小化）', () => {
    const r = validateOrderInput({ ...base, address: '仙台市青葉区1-1', phone: '022-000-0000' });
    if (typeof r === 'string') throw new Error(r);
    expect(r.address).toBe('');
    expect(r.phone).toBe('');
  });

  it('名前が空ならエラー', () => {
    expect(validateOrderInput({ ...base, name: '   ' })).toBe('お名前を入力してください');
  });

  it('名前が50文字超ならエラー', () => {
    expect(validateOrderInput({ ...base, name: 'あ'.repeat(51) })).toBe('お名前が長すぎます（50文字以内）');
  });

  it('サイズ未選択・不正ならエラー', () => {
    expect(validateOrderInput({ ...base, size: '' })).toBe('サイズを選んでください');
    expect(validateOrderInput({ ...base, size: '3XL' })).toBe('サイズを選んでください');
  });

  it('枚数は1以上の整数', () => {
    expect(validateOrderInput({ ...base, qty: 0 })).toBe('枚数は1枚以上で入力してください');
    expect(validateOrderInput({ ...base, qty: 1.5 })).toBe('枚数は1枚以上で入力してください');
    expect(validateOrderInput({ ...base, qty: 21 })).toBe('一度に注文できるのは20枚までです');
  });

  it('郵送希望なら住所が必須', () => {
    expect(validateOrderInput({ ...base, wantsShipping: true, paymentMethod: 'stripe', phone: '09000000000' }))
      .toBe('郵送先のご住所を入力してください');
  });

  it('郵送希望なら電話番号が必須', () => {
    expect(validateOrderInput({ ...base, wantsShipping: true, paymentMethod: 'stripe', address: '仙台市青葉区1-1' }))
      .toBe('お電話番号を入力してください');
  });

  it('電話番号は数字10〜11桁（ハイフン可）', () => {
    const withAddr = { ...base, wantsShipping: true, paymentMethod: 'stripe' as const, address: '仙台市青葉区1-1' };
    expect(validateOrderInput({ ...withAddr, phone: '123' })).toBe('お電話番号の形式が正しくありません');
    const ok = validateOrderInput({ ...withAddr, phone: '090-1234-5678' });
    if (typeof ok === 'string') throw new Error(ok);
    expect(ok.phone).toBe('090-1234-5678');
    expect(ok.address).toBe('仙台市青葉区1-1');
    expect(ok.wantsShipping).toBe(true);
  });
});

describe('calcOrderTotal', () => {
  it('3,500円 × 枚数', () => {
    expect(calcOrderTotal(1, false, S)).toBe(3500);
    expect(calcOrderTotal(3, false, S)).toBe(10500);
  });

  it('郵送は1注文につき+800円（枚数分ではない）', () => {
    expect(calcOrderTotal(1, true, S)).toBe(4300);
    expect(calcOrderTotal(3, true, S)).toBe(11300);
  });
});

import {
  acceptanceState,
  summarizeBySize,
  buildOrderCsv,
  generateOrderToken,
  type OrderRow,
} from '../tshirtOrder';

describe('acceptanceState', () => {
  it('受付開始前は before', () => {
    expect(acceptanceState(S, '2026-08-21')).toBe('before');
  });

  it('開始日当日は open（境界を含む）', () => {
    expect(acceptanceState(S, '2026-08-22')).toBe('open');
  });

  it('締切日当日は open（締切日いっぱいまで受け付ける）', () => {
    expect(acceptanceState(S, '2026-08-29')).toBe('open');
  });

  it('締切日の翌日は closed', () => {
    expect(acceptanceState(S, '2026-08-30')).toBe('closed');
  });

  it('受付スイッチOFFなら期間内でも suspended', () => {
    expect(acceptanceState({ ...S, isOpen: false }, '2026-08-25')).toBe('suspended');
  });

  it('日付が未設定なら期間で弾かない（スイッチのみで判定）', () => {
    expect(acceptanceState({ ...S, openAt: '', closeAt: '' }, '2027-01-01')).toBe('open');
  });
});

describe('summarizeBySize', () => {
  it('サイズ別の合計枚数を返す（発注用・0枚のサイズも欠かさない）', () => {
    const rows = [
      { size: 'M' as const, qty: 2 },
      { size: 'M' as const, qty: 1 },
      { size: '2XL' as const, qty: 3 },
    ];
    expect(summarizeBySize(rows)).toEqual({ S: 0, M: 3, L: 0, XL: 0, '2XL': 3 });
  });
});

describe('buildOrderCsv', () => {
  const rows: OrderRow[] = [
    {
      id: 1, name: 'キムラ', size: 'L', qty: 2, wantsShipping: false,
      address: '', phone: '', totalAmount: 7000, createdAt: '2026-08-22 10:00',
    },
    {
      id: 2, name: 'サトウ, ハナ', size: 'S', qty: 1, wantsShipping: true,
      address: '仙台市青葉区1-1', phone: '090-1234-5678', totalAmount: 4300, createdAt: '2026-08-23 11:00',
    },
  ];

  it('ヘッダーと明細を出す', () => {
    const csv = buildOrderCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('注文番号,お名前,サイズ,枚数,受け取り方法,住所,電話番号,合計金額,注文日時');
    expect(lines[1]).toBe('1,キムラ,L,2,レッスンで受け取り,,,7000,2026-08-22 10:00');
  });

  it('カンマを含む値をクォートする', () => {
    const csv = buildOrderCsv(rows);
    expect(csv.split('\n')[2]).toBe('2,"サトウ, ハナ",S,1,郵送,仙台市青葉区1-1,090-1234-5678,4300,2026-08-23 11:00');
  });
});

describe('generateOrderToken', () => {
  it('48桁の16進トークンを毎回違う値で返す', () => {
    const a = generateOrderToken();
    const b = generateOrderToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });
});

describe('paymentMethod', () => {
  const base = { name: '木村', size: 'L', qty: 1, wantsShipping: false, email: 't@example.com' };

  it('未指定なら cash', () => {
    const r = validateOrderInput(base);
    if (typeof r === 'string') throw new Error(r);
    expect(r.paymentMethod).toBe('cash');
  });

  it('stripe を指定できる', () => {
    const r = validateOrderInput({ ...base, paymentMethod: 'stripe' });
    if (typeof r === 'string') throw new Error(r);
    expect(r.paymentMethod).toBe('stripe');
  });

  it('不正な値はエラー', () => {
    expect(validateOrderInput({ ...base, paymentMethod: 'paypal' }))
      .toBe('お支払い方法を選んでください');
  });
});

describe('郵送は事前決済のみ', () => {
  const ship = { name: '木村', size: 'L', qty: 1, wantsShipping: true, address: '仙台市青葉区1-1', phone: '090-1234-5678', email: 't@example.com' };

  it('郵送+現金はエラー(手渡しの機会がなく集金できないため)', () => {
    expect(validateOrderInput({ ...ship, paymentMethod: 'cash' }))
      .toBe('郵送をご希望の場合は、カード決済（事前のお支払い）のみとなります');
  });

  it('郵送+カードは通る', () => {
    const r = validateOrderInput({ ...ship, paymentMethod: 'stripe' });
    if (typeof r === 'string') throw new Error(r);
    expect(r.wantsShipping).toBe(true);
    expect(r.paymentMethod).toBe('stripe');
  });

  it('郵送で支払い方法未指定もエラー(黙ってcashに落とさない)', () => {
    expect(typeof validateOrderInput(ship)).toBe('string');
  });
});

import { defaultSizeChart, parseSizeChart, type SizeChartRow } from '../tshirtOrder';

describe('サイズチャート', () => {
  it('初期値は5サイズ全部の行がある(身丈/身幅/肩幅/袖丈)', () => {
    const rows = defaultSizeChart();
    expect(rows.map((r) => r.size)).toEqual(['S', 'M', 'L', 'XL', '2XL']);
    for (const r of rows) {
      expect(r.length).toBeGreaterThan(0);
      expect(r.width).toBeGreaterThan(0);
      expect(r.shoulder).toBeGreaterThan(0);
      expect(r.sleeve).toBeGreaterThan(0);
    }
  });

  it('JSONの往復ができる', () => {
    const rows = defaultSizeChart();
    expect(parseSizeChart(JSON.stringify(rows))).toEqual(rows);
  });

  it('壊れたJSON・空文字は初期値に落ちる', () => {
    expect(parseSizeChart('')).toEqual(defaultSizeChart());
    expect(parseSizeChart('not json')).toEqual(defaultSizeChart());
    expect(parseSizeChart('[]')).toEqual(defaultSizeChart());
  });

  it('数値でない値が混ざった行は捨てて残りを使う', () => {
    const rows: SizeChartRow[] = defaultSizeChart();
    const dirty = JSON.stringify([...rows, { size: 'S', length: 'x', width: 1, shoulder: 1, sleeve: 1 }]);
    expect(parseSizeChart(dirty)).toEqual(rows);
  });
});

describe('メールアドレス', () => {
  const base = { name: '木村', size: 'L', qty: 1, wantsShipping: false, email: 'taro@example.com' };

  it('正常系: trim+小文字化して通る', () => {
    const r = validateOrderInput({ ...base, email: ' Taro@Example.com ' });
    if (typeof r === 'string') throw new Error(r);
    expect(r.email).toBe('taro@example.com');
  });

  it('未入力はエラー', () => {
    expect(validateOrderInput({ ...base, email: '' })).toBe('メールアドレスを入力してください');
    expect(validateOrderInput({ ...base, email: undefined })).toBe('メールアドレスを入力してください');
  });

  it('形式不正はエラー', () => {
    for (const bad of ['aaa', 'a@b', 'a b@c.com', '@c.com']) {
      expect(validateOrderInput({ ...base, email: bad })).toBe('メールアドレスの形式が正しくありません');
    }
  });
});
