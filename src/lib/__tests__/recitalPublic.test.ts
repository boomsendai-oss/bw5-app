// src/lib/__tests__/recitalPublic.test.ts
import { describe, it, expect } from 'vitest';
import { parseRecitalSettings } from '../recital';
import type { FeeRule } from '../recitalFee';
import { yenJa, jpDate, slashDate, slashDateTime, jpOpenLabel, fiveLines, feeTableFromRules, publicPhase, RECITAL_MSG } from '../recitalPublic';

const r = (payer_role: 'first' | 'family', item_code: FeeRule['item_code'], nth_from: number, nth_to: number | null, unit_amount: number, qty: number, label: string, sort_order: number): FeeRule =>
  ({ payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative: 0, sort_order });
// 03 3-4 の「初めに入れる行」8行そのまま
const RULES: FeeRule[] = [
  r('first', 'base', 1, 1, 16000, 1, '出演料（本体）', 1),
  r('first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 2),
  r('first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚', 3),
  r('first', 'add_work', 2, 2, 6000, 1, '2作品目', 4),
  r('first', 'add_work', 3, null, 3000, 1, '3作品目から（1作品ごと）', 5),
  r('family', 'base', 1, 1, 5000, 1, 'ご家族の参加費', 6),
  r('family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 7),
  r('family', 'add_work', 2, null, 3000, 1, '2作品目から（1作品ごと）', 8),
];

describe('表示の言葉', () => {
  it('金額と日付（曜日は日付から出す）', () => {
    expect(yenJa(26500)).toBe('26,500円');
    expect(yenJa(0)).toBe('0円');
    expect(jpDate('2027-02-10')).toBe('2月10日（水）');
    expect(jpDate('2027-01-31 23:59')).toBe('1月31日（日）');
    expect(slashDate('2027-01-31 23:59')).toBe('1/31（日）');
    expect(slashDateTime('2027-01-31 23:59')).toBe('1/31（日）23:59');
    expect(jpOpenLabel('2026-12-15 12:00')).toBe('12月15日（火）12時');
    expect(jpOpenLabel('2026-12-15 12:30')).toBe('12月15日（火）12時30分');
  });
  it('連打よけと混んだ時の文（R-33）', () => {
    expect(RECITAL_MSG.rate).toBe('少し時間をおいて、もう一度お試しください。');
    expect(RECITAL_MSG.busy).toBe('ただいま混み合っています。もう一度『送る』を押してください。二重にはなりません。');
  });
});

describe('短い5行（R-35）', () => {
  it('初めの設定なら設計書の文のまま', () => {
    expect(fiveLines(parseRecitalSettings([]))).toEqual([
      'お申し込みのときは、お支払いはありません。送ると「仮受付」になります。',
      'お支払いは、お申し込みのすぐあとから 2月10日（水）まで、いつでもできます。カードか銀行振込です。お支払いいただいた時点で「申込完了」です。',
      '1/31（日）までは、マイページで作品を足したり、やめたりできます。「まだ迷っている」でも申し込めます。迷っている作品がある方は、決まってからお支払いください。',
      'お支払いのあとに作品を足したときは、足した分だけを、同じ「払う」からお支払いください。',
      'お支払いのあとは、お返しできません。スクールの都合で作品がなくなったときは、その分をお返しします。',
    ]);
  });
  it('日付は設定から差し込む', () => {
    const s = parseRecitalSettings([{ key: 'pay_due', value: '2027-02-12' }, { key: 'change_close_at', value: '2027-01-30 23:59' }]);
    expect(fiveLines(s)[1]).toContain('2月12日（金）まで');
    expect(fiveLines(s)[2].startsWith('1/30（土）までは')).toBe(true);
  });
});

describe('料金の早見（数は規則から。04 4-2）', () => {
  it('1人目の1〜5作品・家族2人目・家族の例', () => {
    expect(feeTableFromRules(RULES, 5)).toEqual({
      first: [26500, 32500, 35500, 38500, 41500],
      familyFirst: 8000,
      familyAdd: 3000,
      examples: [
        { label: '2人が1作品ずつ', total: 34500 },
        { label: '兄2作品・妹1作品', total: 37500 },
        { label: '3人が1作品ずつ', total: 42500 },
        { label: '4人が1作品ずつ', total: 50500 },
      ],
    });
  });
  it('1人目の表の長さは max_works_per_person', () => {
    expect(feeTableFromRules(RULES, 3).first).toEqual([26500, 32500, 35500]);
  });
});

describe('表示用の受付の状態', () => {
  const s = parseRecitalSettings([]); // entry_open_at 2026-12-15 12:00
  const before = Date.parse('2026-12-10T12:00:00+09:00');
  const after = Date.parse('2026-12-15T12:00:00+09:00');
  it('止めていても、開ける時刻の前なら「受付前」と出す（表示だけ）', () => {
    expect(publicPhase('suspended', false, before, s)).toBe('before');
    expect(publicPhase('suspended', false, after, s)).toBe('suspended');
  });
  it('試し用の鍵が合えば「受付中」の画面を出す', () => {
    expect(publicPhase('before', true, before, s)).toBe('open');
  });
  it('ほかはそのまま', () => {
    expect(publicPhase('closed', false, after, s)).toBe('closed');
    expect(publicPhase('open', false, after, s)).toBe('open');
  });
});
