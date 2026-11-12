import { describe, it, expect } from 'vitest';
import iconv from 'iconv-lite';
import { BANK_BATCH_MAX_ROWS, validateBatchShape, inferRowYear, buildRowKey, normalizeBatch, checkBatch, flagRows, parseGmoStatementCsv, type BankBatchIn, type BankBatchRowIn, type LedgerRowLite } from '../recitalBankBatch';

const r = (pos: string, date: string, dir: 'in' | 'out', amount: number | null, balance: number | null, kind: 'transfer' | 'debit' | 'other', desc = '', over: Partial<BankBatchRowIn> = {}): BankBatchRowIn =>
  ({ pos, date, dir, amount, balance, kind, desc, cut: false, unread: '', ...over });
const b = (rows: BankBatchRowIn[], over: Partial<BankBatchIn> = {}): BankBatchIn =>
  ({ event_key: 't-batch', source: 'chat', shot_on: '2026-12-16', range_from: '2026-12-14', range_to: '2026-12-16', images: 2, account: '円普通預金', rows, ...over });
// 2枚。1-3 と 2-1 が重ねた同じ行。いちばん下はデビット（last の印が付かない形）
const SAMPLE = [
  r('1-1', '12/16', 'in', 26500, 153000, 'transfer', '振込　４８２３　ヤマダ　ハナコ'),
  r('1-2', '12/15', 'out', 1000, 126500, 'debit'),
  r('1-3', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
  r('2-1', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
  r('2-2', '12/14', 'out', 500, 121500, 'debit'),
  r('2-3', '12/14', 'out', 3000, 122000, 'debit'),
];
const L = (over: Partial<LedgerRowLite>): LedgerRowLite => ({ id: 1, row_key: '', row_date: '2026-12-15', dir: 'in', amount: 6000, balance: 127500, kind: 'transfer', source: 'chat', state: 'new', ...over });

describe('validateBatchShape', () => {
  it('形が合えば ok', () => expect(validateBatchShape(b(SAMPLE)).ok).toBe(true));
  it('source がちがう・event_key が空・行が多すぎるは ng', () => {
    expect(validateBatchShape({ ...b(SAMPLE), source: 'x' }).ok).toBe(false);
    expect(validateBatchShape({ ...b(SAMPLE), event_key: '' }).ok).toBe(false);
    expect(validateBatchShape(b(Array.from({ length: BANK_BATCH_MAX_ROWS + 1 }, (_, i) => r(`1-${i + 1}`, '12/16', 'out', 1, 1, 'debit')))).ok).toBe(false);
  });
  it('amount が null なのに unread に amount が無いのは ng', () => {
    expect(validateBatchShape(b([r('1-1', '12/16', 'in', null, 1, 'transfer')])).ok).toBe(false);
    expect(validateBatchShape(b([r('1-1', '12/16', 'in', null, 1, 'transfer', '', { unread: 'amount' })])).ok).toBe(true);
  });
  it('manual は残高が空なら ng・日付は年月日', () => {
    expect(validateBatchShape(b([r('m-1', '2026-12-16', 'in', 26500, null, 'transfer', '振込 4823 ヤマダ ハナコ')], { source: 'manual', images: 0 })).ok).toBe(false);
    expect(validateBatchShape(b([r('m-1', '12/16', 'in', 26500, 1, 'transfer', 'x')], { source: 'manual', images: 0 })).ok).toBe(false);
  });
  // Task 30：読む役の手順書（boom-events-hub/docs/bw6-bank-read.md）に載せる見本の束と同じ物
  it('手順書の見本の束は形が合う', () => {
    const sample = { event_key: 'bw6', source: 'chat', shot_on: '2026-12-16', range_from: '2026-12-14', range_to: '2026-12-16', images: 1, account: '円普通預金',
      rows: [{ pos: '1-1', date: '12/16', dir: 'in', amount: 26500, balance: 100000, kind: 'transfer', desc: '振込　４８２７　ヤマダ　ハナコ', cut: false, unread: '' },
             { pos: '1-2', date: '12/15', dir: 'out', amount: 1000, balance: 73500, kind: 'debit', desc: '', cut: false, unread: '' }] };
    expect(validateBatchShape(sample).ok).toBe(true);
  });
});

describe('inferRowYear（渡した日 JST より先にならない、いちばん新しい年）', () => {
  it('1/4 に渡した 12/29 は 2026年', () => expect(inferRowYear('12/29', '2027-01-04')).toBe('2026-12-29'));
  it('当日はその年・1日でも先なら前の年', () => {
    expect(inferRowYear('1/4', '2027-01-04')).toBe('2027-01-04');
    expect(inferRowYear('01/05', '2027-01-04')).toBe('2026-01-05');
  });
  it('ない日付は空', () => expect(inferRowYear('2/30', '2027-03-01')).toBe(''));
});

describe('normalizeBatch', () => {
  it('重ね撮りを1本にする（6行→5行）・年を決める・番号を読む', () => {
    const rows = normalizeBatch(b(SAMPLE), '2026-12-16');
    expect(rows.map((x) => x.pos)).toEqual(['1-1', '1-2', '1-3', '2-2', '2-3']);
    expect(rows[0]).toMatchObject({ rowDate: '2026-12-16', refRead: '4823', refOk: 1, descRaw: '振込　４８２３　ヤマダ　ハナコ', rowKey: '2026-12-16|in|26500|153000' });
    expect(rows[1]).toMatchObject({ descRaw: null, refRead: null, refOk: 0 }); // 出金は摘要を持たない
  });
  it('同じ鍵が1つの束に2つ：下が鍵のまま、上に #2', () => {
    const rows = normalizeBatch(b([
      r('1-1', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
      r('1-2', '12/15', 'out', 6000, 121500, 'debit'),
      r('1-3', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
    ], { images: 1 }), '2026-12-16');
    expect(rows[0].rowKey).toBe('2026-12-15|in|6000|127500#2');
    expect(rows[2].rowKey).toBe('2026-12-15|in|6000|127500');
  });
  it('4827 は検査に合わない（refOk 0）', () => {
    expect(normalizeBatch(b([r('1-1', '12/16', 'in', 26500, 1, 'transfer', '振込 4827 ヤマダ ハナコ')], { images: 1 }), '2026-12-16')[0]).toMatchObject({ refRead: '4827', refOk: 0 });
  });
});

describe('checkBatch', () => {
  const ok = (bb: BankBatchIn, ledger: LedgerRowLite[] = [], startDate = '2026-12-14') => checkBatch(bb, normalizeBatch(bb, '2026-12-16'), ledger, { startDate });
  it('合う束', () => expect(ok(b(SAMPLE))).toEqual({ ok: true }));
  it('残高が1円ちがう → いちばん上のあたり（12/16 の 26,500円）', () => {
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    expect(ok(b(bad))).toEqual({ ok: false, near: { date: '2026-12-16', amount: 26500 } });
  });
  it('日付が下へ新しくなる → ng', () => {
    const bad = SAMPLE.map((x) => (x.pos === '2-3' ? { ...x, date: '12/16' } : x));
    expect(ok(b(bad)).ok).toBe(false);
  });
  it('枚のつなぎ目に重ねた行が無い → 1枚目のいちばん下のあたり', () => {
    expect(ok(b(SAMPLE.filter((x) => x.pos !== '2-1')))).toMatchObject({ ok: false, near: { date: '2026-12-15', amount: 6000 } });
  });
  it('期間の開始日が声かけの日より後 → ng（amount 0 で開始日を返す）', () => {
    expect(ok(b(SAMPLE, { range_from: '2026-12-15' }))).toEqual({ ok: false, near: { date: '2026-12-14', amount: 0 } });
  });
  it('金額が読めない行がある束は入れない', () => {
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, amount: null, unread: 'amount' } : x));
    expect(ok(b(bad)).ok).toBe(false);
  });
  it('摘要だけ読めない行は入れる', () => {
    const u = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, unread: 'desc' } : x));
    expect(ok(b(u))).toEqual({ ok: true });
  });
  it('前の日までの振込の入金と、残高まで同じ行がある → ok', () => {
    expect(ok(b(SAMPLE), [L({ id: 7, row_key: '2026-12-15|in|6000|127500' })])).toEqual({ ok: true });
  });
  it('つなぎ目だけ合わない → 台帳の行と今回の行を並べて返す', () => {
    expect(ok(b(SAMPLE), [L({ id: 7, row_key: '2026-12-15|in|6000|127000', balance: 127000 })]))
      .toMatchObject({ ok: false, joinMismatch: [{ ledgerRowId: 7, pos: '1-3' }] });
  });
  it('つなぎ目は manual の行・デビットの行では見ない', () => {
    expect(ok(b(SAMPLE), [L({ id: 8, source: 'manual', balance: 999, row_key: '2026-12-15|in|6000|999' })])).toEqual({ ok: true });
  });
  it('manual は検算を見ない（残高があれば ok）・file は 1 と 2 だけ（開始日は見ない）', () => {
    const m = b([r('m-1', '2026-12-16', 'in', 26500, 999, 'transfer', '振込 4823 ヤマダ ハナコ')], { source: 'manual', images: 0 });
    expect(checkBatch(m, normalizeBatch(m, '2026-12-16'), [], { startDate: '2026-12-14' })).toEqual({ ok: true });
    const f = b(SAMPLE.filter((x) => x.pos !== '2-1').map((x, i) => ({ ...x, pos: `f-${i + 2}`, date: `2026-${x.date.replace('/', '-')}` })), { source: 'file', images: 0, range_from: '2026-12-15' });
    expect(checkBatch(f, normalizeBatch(f, '2026-12-16'), [], { startDate: '2026-12-14' })).toEqual({ ok: true });
  });
});

describe('flagRows', () => {
  const norm = (rows: BankBatchRowIn[]) => normalizeBatch(b(rows, { images: 1 }), '2026-12-16');
  it('日付だけちがう・金額だけちがう台帳の行 → twin', () => {
    const rows = norm([r('1-1', '12/16', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'), r('1-2', '12/16', 'out', 1, 121500, 'debit')]);
    expect(flagRows(rows, [L({ row_key: '2026-12-15|in|6000|127500' })])[0].checkFlag).toBe('twin');
    expect(flagRows(rows, [L({ row_date: '2026-12-16', amount: 5000, row_key: '2026-12-16|in|5000|127500' })])[0].checkFlag).toBe('twin');
  });
  it('いちばん下が台帳にまだ無い振込の入金 → last／もうある行なら付かない', () => {
    const rows = norm([r('1-1', '12/16', 'out', 1, 127499, 'debit'), r('1-2', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ')]);
    expect(flagRows(rows, [])[1].checkFlag).toBe('last');
    expect(flagRows(rows, [L({ row_key: '2026-12-15|in|6000|127500' })])[1].checkFlag).toBe(null);
  });
  it('日付・入出・金額が同じ manual の行が台帳にある → manual_twin（twin より先）', () => {
    const rows = norm([r('1-1', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'), r('1-2', '12/15', 'out', 1, 121500, 'debit')]);
    expect(flagRows(rows, [L({ source: 'manual', balance: 999, row_key: '2026-12-15|in|6000|999' })])[0].checkFlag).toBe('manual_twin');
  });
});

describe('parseGmoStatementCsv', () => {
  it('Shift_JIS の CSV を、上が新しい順の行にする', () => {
    const csv = '日付,摘要,入金金額,出金金額,残高,メモ\r\n2026/12/15,ﾃﾞﾋﾞｯﾄ,,1000,126500,\r\n2026/12/16,振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ,26500,,153000,\r\n';
    const rows = parseGmoStatementCsv(new Uint8Array(iconv.encode(csv, 'shift_jis')));
    expect(rows).toEqual([
      { pos: 'f-3', date: '2026-12-16', dir: 'in', amount: 26500, balance: 153000, kind: 'transfer', desc: '振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ', cut: false, unread: '' },
      { pos: 'f-2', date: '2026-12-15', dir: 'out', amount: 1000, balance: 126500, kind: 'debit', desc: '', cut: false, unread: '' },
    ]);
  });
  it('古い順の CSV を読み、normalizeBatch（file）を通しても新しい順のまま・検算に合う（並べ直さない）', () => {
    const csv = '日付,摘要,入金金額,出金金額,残高,メモ\r\n2026/12/15,ﾃﾞﾋﾞｯﾄ,,1000,126500,\r\n2026/12/16,振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ,26500,,153000,\r\n';
    const f = b(parseGmoStatementCsv(new Uint8Array(iconv.encode(csv, 'shift_jis'))), { source: 'file', images: 0, range_from: '2026-12-15', range_to: '2026-12-16' });
    const n = normalizeBatch(f, '2026-12-16');
    expect(n.map((x) => x.pos)).toEqual(['f-3', 'f-2']);
    expect(checkBatch(f, n, [], { startDate: '2026-12-14' })).toEqual({ ok: true });
  });
});

it('buildRowKey', () => expect(buildRowKey({ rowDate: '2026-12-16', dir: 'in', amount: 26500, balance: 153000 })).toBe('2026-12-16|in|26500|153000'));

// ---- 見直しの直し（controller の裁定 1〜6） ----
describe('重ね撮り：2行以上の重なり（裁定1）・説明の欠けていない方を残す（裁定2）', () => {
  const S1 = [
    r('1-1', '12/16', 'in', 26500, 153000, 'transfer', '振込 4823 ヤマダ ハナコ'),
    r('1-2', '12/15', 'out', 1000, 126500, 'debit'),
    r('1-3', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
  ];
  const tail = (sheet: number, from: number) => [
    r(`${sheet}-${from}`, '12/14', 'out', 500, 121500, 'debit'),
    r(`${sheet}-${from + 1}`, '12/14', 'out', 3000, 122000, 'debit'),
  ];
  const copy = (x: BankBatchRowIn, pos: string, over: Partial<BankBatchRowIn> = {}) => ({ ...x, pos, ...over });
  const run = (rows: BankBatchRowIn[]) => {
    const bb = b(rows);
    const n = normalizeBatch(bb, '2026-12-16');
    return { n, c: checkBatch(bb, n, [], { startDate: '2026-12-14' }) };
  };
  it('2行の重なり → 1本にして ok', () => {
    const { n, c } = run([...S1, copy(S1[1], '2-1'), copy(S1[2], '2-2'), ...tail(2, 3)]);
    expect(n.map((x) => x.pos)).toEqual(['1-1', '1-2', '1-3', '2-3', '2-4']);
    expect(c).toEqual({ ok: true });
  });
  it('3行の重なり → 1本にして ok', () => {
    const { n, c } = run([...S1, copy(S1[0], '2-1'), copy(S1[1], '2-2'), copy(S1[2], '2-3'), ...tail(2, 4)]);
    expect(n.map((x) => x.pos)).toEqual(['1-1', '1-2', '1-3', '2-4', '2-5']);
    expect(c).toEqual({ ok: true });
  });
  it('重なりが無い → ng（1枚目のいちばん下のあたり）', () => {
    expect(run([...S1, ...tail(2, 1)]).c).toEqual({ ok: false, near: { date: '2026-12-15', amount: 6000 } });
  });
  it('1枚目の行の説明が切れている（cut）→ 2枚目の欠けていない方を、同じ位置に残す', () => {
    const cutRow = copy(S1[2], '1-3', { desc: '振込 4867 ヤマ', cut: true });
    const { n, c } = run([S1[0], S1[1], cutRow, copy(S1[2], '2-1'), ...tail(2, 2)]);
    expect(n.map((x) => x.pos)).toEqual(['1-1', '1-2', '2-1', '2-2', '2-3']);
    expect(n[2]).toMatchObject({ descRaw: '振込 4867 ヤマダ タロウ', cut: 0, unread: null, refRead: '4867' });
    expect(c).toEqual({ ok: true });
  });
  it('1枚目の行の説明が読めない（unread に desc）→ 2枚目の方を残す。両方欠けていれば1枚目のまま', () => {
    const u = copy(S1[2], '1-3', { unread: 'desc' });
    expect(run([S1[0], S1[1], u, copy(S1[2], '2-1'), ...tail(2, 2)]).n[2].pos).toBe('2-1');
    expect(run([S1[0], S1[1], u, copy(S1[2], '2-1', { cut: true }), ...tail(2, 2)]).n[2].pos).toBe('1-3');
  });
});

describe('parseGmoStatementCsv の直し（裁定3〜6）', () => {
  const H = '日付,摘要,入金金額,出金金額,残高,メモ\r\n';
  const enc = (s: string) => new Uint8Array(iconv.encode(H + s, 'shift_jis'));
  const fileBatch = (rows: BankBatchRowIn[]) => b(rows, { source: 'file', images: 0, range_from: '2026-12-15', range_to: '2026-12-15' });
  it('1日だけの古い順 CSV → 残高のつながりで向きを決め、新しい順にして検算に合う', () => {
    const rows = parseGmoStatementCsv(enc('2026/12/15,ﾃﾞﾋﾞｯﾄ,,1000,126500,\r\n2026/12/15,振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ,26500,,153000,\r\n'));
    expect(rows.map((x) => x.pos)).toEqual(['f-3', 'f-2']);
    const f = fileBatch(rows);
    expect(checkBatch(f, normalizeBatch(f, '2026-12-16'), [], { startDate: '2026-12-14' })).toEqual({ ok: true });
  });
  it('1日だけの新しい順 CSV → そのまま', () => {
    const rows = parseGmoStatementCsv(enc('2026/12/15,振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ,26500,,153000,\r\n2026/12/15,ﾃﾞﾋﾞｯﾄ,,1000,126500,\r\n'));
    expect(rows.map((x) => x.pos)).toEqual(['f-2', 'f-3']);
  });
  it('数字だけを読む（0x10・1e3 は読めない）', () => {
    const rows = parseGmoStatementCsv(enc('2026/12/15,振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ,0x10,,1e3,\r\n'));
    expect(rows[0]).toMatchObject({ amount: null, balance: null, unread: 'amount,balance' });
    expect(parseGmoStatementCsv(enc('2026/12/15,ﾃﾞﾋﾞｯﾄ,,"1,000円",￥126500,\r\n'))[0]).toMatchObject({ amount: 1000, balance: 126500, unread: '' });
  });
  it('入金と出金の両方に金額がある行 → 金額は読めない（止める）', () => {
    const rows = parseGmoStatementCsv(enc('2026/12/15,振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ,26500,1000,153000,\r\n'));
    expect(rows[0]).toMatchObject({ amount: null, unread: 'amount' });
  });
  it('金額・残高が空か数でない → 0 にせず読めない、束は ng', () => {
    const rows = parseGmoStatementCsv(enc('2026/12/15,振込 4823 ﾔﾏﾀﾞ ﾊﾅｺ,26500,,,\r\n2026/12/15,ﾃﾞﾋﾞｯﾄ,,abc,126500,\r\n2026/12/15,ﾃﾞﾋﾞｯﾄ,,,126000,\r\n'));
    expect(rows.map((x) => [x.amount, x.balance, x.unread])).toEqual([[26500, null, 'balance'], [null, 126500, 'amount'], [null, 126000, 'amount']]);
    for (const row of rows) {
      const f = fileBatch([row]);
      expect(validateBatchShape(f).ok).toBe(true);
      expect(checkBatch(f, normalizeBatch(f, '2026-12-16'), [], { startDate: '2026-12-14' }).ok).toBe(false);
    }
  });
});

// ---- 見直しの直し2（controller の裁定） ----
describe('重ね撮り：説明が両方そろっている写しは説明も同じでないと重ねない（直し2-1）', () => {
  const top = r('1-1', '12/16', 'in', 26500, 154000, 'transfer', '振込 4823 ヤマダ ハナコ');
  const X1 = (pos: string) => r(pos, '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ');
  const Z = (pos: string) => r(pos, '12/15', 'out', 6000, 121500, 'debit');
  const X0 = (pos: string) => r(pos, '12/15', 'in', 6000, 127500, 'transfer', '振込 4823 ヤマダ ハナコ');
  const W = (pos: string) => r(pos, '12/15', 'out', 500, 127500, 'debit');
  const run = (rows: BankBatchRowIn[]) => {
    const bb = b(rows);
    const n = normalizeBatch(bb, '2026-12-16');
    return { n, c: checkBatch(bb, n, [], { startDate: '2026-12-14' }) };
  };
  it('重ねずに続けて撮った2枚（+6000/−6000 が2回・残高も同じ）を重ねない → つなぎ目に重なりが無いので ng', () => {
    const { n, c } = run([top, X1('1-2'), Z('1-3'), X0('2-1'), Z('2-2'), W('2-3')]);
    expect(n.map((x) => x.pos)).toEqual(['1-1', '1-2', '1-3', '2-1', '2-2', '2-3']);
    expect(c).toEqual({ ok: false, near: { date: '2026-12-15', amount: 6000 } });
  });
  it('本当に2行重ねた2枚（説明は NFKC で同じ）→ 1本にして ok', () => {
    const { n, c } = run([top, X1('1-2'), Z('1-3'), { ...X1('2-1'), desc: '振込　４８６７　ヤマダ　タロウ' }, Z('2-2'), X0('2-3'), Z('2-4'), W('2-5')]);
    expect(n.map((x) => x.pos)).toEqual(['1-1', '1-2', '1-3', '2-3', '2-4', '2-5']);
    expect(c).toEqual({ ok: true });
  });
  it('どちらかの写しの説明が欠けていれば、説明はくらべない（今までどおり重ねる）', () => {
    const { n, c } = run([top, { ...X1('1-2'), cut: true, desc: '振込 4823 ヤマ' }, Z('1-3'), X1('2-1'), Z('2-2'), X0('2-3'), Z('2-4'), W('2-5')]);
    expect(n.map((x) => x.pos)).toEqual(['1-1', '2-1', '1-3', '2-3', '2-4', '2-5']);
    expect(c).toEqual({ ok: true });
  });
});

it('明細CSV：入金も出金も 0 の行 → 金額は読めない（直し2-2）', () => {
  const csv = '日付,摘要,入金金額,出金金額,残高,メモ\r\n2026/12/15,ﾃﾞﾋﾞｯﾄ,0,0,126500,\r\n';
  expect(parseGmoStatementCsv(new Uint8Array(iconv.encode(csv, 'shift_jis')))[0]).toMatchObject({ amount: null, unread: 'amount' });
});
