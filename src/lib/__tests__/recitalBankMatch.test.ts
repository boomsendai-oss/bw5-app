import { describe, it, expect } from 'vitest';
import { decideRow, candidatesFor, surnameMatches, type MatchHousehold, type MatchRow } from '../recitalBankMatch';

const H = (over: Partial<MatchHousehold> = {}): MatchHousehold => ({ id: 1, refCode: '4823', status: 'active', mergedInto: null, view: 'tentative', remaining: 26500, totalBeforeLastDrop: null, surnamesKana: ['ヤマダ'], told: null, ...over });
const R = (over: Partial<MatchRow> = {}): MatchRow => ({ id: 10, source: 'chat', dir: 'in', kind: 'transfer', amount: 26500, remainingOfRow: 26500, refRead: '4823', refOk: 1, nameRaw: 'ヤマダハナコ', unread: null, cut: 0, checkFlag: null, rowDate: '2026-12-16', ...over });
const by = (...hs: MatchHousehold[]) => new Map(hs.map((h) => [h.refCode, h]));
const CTX = { first5Done: 5, firstOk: false, sameRefOpenAmounts: [] as number[] };
const kind = (row: MatchRow, hs: MatchHousehold[], ctx = CTX) => decideRow(row, by(...hs), ctx);

describe('decideRow：場面の表（05 5-6）', () => {
  it('1 ぴったり → 自動', () => expect(kind(R(), [H()])).toEqual({ auto: true, householdId: 1 }));
  it('2 差額の2回目（今の残り 6,000 に 6,000）→ 自動', () => expect(kind(R({ amount: 6000, remainingOfRow: 6000 }), [H({ view: 'complete_extra', remaining: 6000 })]).auto).toBe(true));
  it('3 同じ番号の2件目（残り 0）→ paid', () => expect(kind(R(), [H({ view: 'complete', remaining: 0 })])).toEqual({ auto: false, reviewKind: 'paid', householdId: 1 }));
  it('4 足すとぴったり（32,500 に 26,500 と 6,000）→ 両方 sum', () => {
    const h = H({ remaining: 32500 });
    expect(kind(R(), [h], { ...CTX, sameRefOpenAmounts: [6000] })).toMatchObject({ reviewKind: 'sum' });
    expect(kind(R({ amount: 6000, remainingOfRow: 6000 }), [h], { ...CTX, sameRefOpenAmounts: [26500] })).toMatchObject({ reviewKind: 'sum' });
  });
  it('5 金額が少ない → short／7 多い → over', () => {
    expect(kind(R(), [H({ remaining: 32500 })])).toMatchObject({ reviewKind: 'short' });
    expect(kind(R({ amount: 32500, remainingOfRow: 32500 }), [H()])).toMatchObject({ reviewKind: 'over' });
  });
  it('10 出演なし・11 まとめた世帯 → gone', () => {
    expect(kind(R(), [H({ view: 'none' })])).toMatchObject({ reviewKind: 'gone' });
    expect(kind(R(), [H({ status: 'merged', mergedInto: 2 })])).toMatchObject({ reviewKind: 'gone' });
  });
  it('12 番号なし → no_ref（姓と金額が合っても当てない）', () => expect(kind(R({ refRead: null, refOk: 0 }), [H()])).toEqual({ auto: false, reviewKind: 'no_ref', householdId: null }));
  it('13・32 例の 4827 は bad_ref／検査に合っても世帯が無ければ bad_ref', () => {
    expect(kind(R({ refRead: '4827', refOk: 0 }), [H()])).toMatchObject({ reviewKind: 'bad_ref' });
    expect(kind(R({ refRead: '4867', refOk: 1 }), [H()])).toMatchObject({ reviewKind: 'bad_ref', householdId: null });
  });
  it('14 姓が合わない → name', () => expect(kind(R({ nameRaw: 'スズキイチロウ' }), [H()])).toMatchObject({ reviewKind: 'name' }));
  it('16 出金・デビット → 見ない', () => {
    expect(kind(R({ dir: 'out' }), [H()])).toEqual({ auto: false, reviewKind: null, householdId: null });
    expect(kind(R({ kind: 'debit' }), [H()])).toEqual({ auto: false, reviewKind: null, householdId: null });
  });
  it('17 読めない → unread（ほかより先）／19 手で打った → manual', () => {
    expect(kind(R({ unread: 'desc', refRead: null }), [H()])).toMatchObject({ reviewKind: 'unread' });
    expect(kind(R({ source: 'manual' }), [H()])).toMatchObject({ reviewKind: 'manual' });
  });
  it('18 後ろが切れていても姓が読めれば自動', () => expect(kind(R({ cut: 1, nameRaw: 'ヤマダハ' }), [H()]).auto).toBe(true));
  it('20 はじめの5件：4件までは first5、はいの束か5件目からは自動', () => {
    expect(kind(R(), [H()], { ...CTX, first5Done: 4 })).toMatchObject({ reviewKind: 'first5' });
    expect(kind(R(), [H()], { ...CTX, first5Done: 4, firstOk: true }).auto).toBe(true);
    expect(kind(R(), [H()], { ...CTX, first5Done: 5 }).auto).toBe(true);
  });
  it('33〜35 印（twin・last・manual_twin）は、5つそろっても自動にしない・種類は付けない（はいがあっても）', () => {
    for (const f of ['twin', 'last', 'manual_twin']) {
      expect(kind(R({ checkFlag: f }), [H()], { ...CTX, firstOk: true })).toEqual({ auto: false, reviewKind: null, householdId: 1 });
    }
  });
  it('比べるのは今の残り（合計 32,500・払った 26,500 → 残り 6,000）', () => {
    expect(kind(R({ amount: 6000, remainingOfRow: 6000 }), [H({ view: 'complete_extra', remaining: 6000 })]).auto).toBe(true);
    expect(kind(R({ amount: 32500, remainingOfRow: 32500 }), [H({ view: 'complete_extra', remaining: 6000 })])).toMatchObject({ reviewKind: 'over' });
  });
  it('36 のこりの行（53,000 のうち 26,500 がのこり）はのこりの額で比べる', () => {
    expect(kind(R({ amount: 53000, remainingOfRow: 26500 }), [H()]).auto).toBe(true);
  });
});

describe('candidatesFor（K203）', () => {
  const A = H({ id: 1, refCode: '4823', surnamesKana: ['ヤマダ'], remaining: 32500 });
  const B = H({ id: 2, refCode: '4867', surnamesKana: ['スズキ'], remaining: 26500 });
  it('39 番号は A・姓と金額は B → B を上に、文を出す。選んだ形にはしない（top は上に出す印）', () => {
    const c = candidatesFor(R({ nameRaw: 'スズキハナコ' }), [A, B]);
    expect(c.list.map((x) => x.householdId)).toEqual([2, 1]);
    expect(c.list[0]).toMatchObject({ top: true });
    expect(c.list[0].why).toEqual(expect.arrayContaining(['amount', 'surname']));
    expect(c.list[1].why).toContain('ref');
    expect(c.notice).toBe('番号とお名前が、別のご家庭を指しています。家庭に確かめてから、押してください');
  });
  it('40 番号なし・同じ姓と金額の世帯が2つ → どちらも上に出さない', () => {
    const X = H({ id: 3, refCode: '4872', surnamesKana: ['ヤマダ'], remaining: 26500 });
    const Y = H({ id: 4, refCode: '6405', surnamesKana: ['ヤマダ'], remaining: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0 }), [X, Y]);
    expect(c.list.every((x) => !x.top)).toBe(true);
    expect(c.notice).toBe('同じ姓・同じ金額のご家庭が 2つあります。家庭に確かめてから、押してください');
  });
  it('40 そのうち「振り込みました」の印（日・金額・名義）が合うのが1つ → その世帯を上に', () => {
    const X = H({ id: 3, refCode: '4872', surnamesKana: ['ヤマダ'], remaining: 26500, told: { date: '2026-12-15', name: 'ヤマダ ハナコ', amount: 26500 } });
    const Y = H({ id: 4, refCode: '6405', surnamesKana: ['ヤマダ'], remaining: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0 }), [X, Y]);
    expect(c.list[0]).toMatchObject({ householdId: 3, top: true });
    expect(c.list[0].why).toContain('told');
  });
  it('9 2家庭まとめ（53,000）→ 同じ姓の2世帯に sum', () => {
    const X = H({ id: 3, refCode: '4872', remaining: 26500 });
    const Y = H({ id: 4, refCode: '6405', remaining: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0, amount: 53000, remainingOfRow: 53000 }), [X, Y]);
    expect(c.list.filter((x) => x.why.includes('sum')).map((x) => x.householdId).sort()).toEqual([3, 4]);
  });
  it('名義のどこかに検査に合う4けた → ref／へらす前の合計と同じ → before_drop／まとめた世帯は先の世帯も', () => {
    const M = H({ id: 5, refCode: '7778', status: 'merged', mergedInto: 6 });
    const T = H({ id: 6, refCode: '8363', surnamesKana: ['タナカ'], remaining: 6000, totalBeforeLastDrop: 26500 });
    const c = candidatesFor(R({ refRead: null, refOk: 0, nameRaw: 'タナカ7778' }), [M, T]);
    expect(c.list.find((x) => x.householdId === 5)?.why).toContain('ref');
    expect(c.list.find((x) => x.householdId === 6)?.why).toEqual(expect.arrayContaining(['ref', 'before_drop', 'surname']));
  });
  it('15 関係ない入金 → 候補0', () => expect(candidatesFor(R({ refRead: null, refOk: 0, nameRaw: 'カ)ナニカ', amount: 1234, remainingOfRow: 1234 }), [A, B]).list).toEqual([]));
});

describe('surnameMatches', () => {
  it('半角・全角・空白・小さいカナをそろえる', () => {
    expect(surnameMatches('ﾔﾏﾀﾞ ﾊﾅｺ', ['ヤマダ'], null)).toBe(true);
    expect(surnameMatches('ヤマダ　ハナコ', ['やまだ'], null)).toBe(true);
    expect(surnameMatches('ｼﾖｳｼﾞﾊﾅｺ', ['ショウジ'], null)).toBe(true);
  });
  it('「振り込みました」の名義と同じなら合う・空の姓では合わない', () => {
    expect(surnameMatches('スズキイチロウ', ['ヤマダ'], 'スズキ イチロウ')).toBe(true);
    expect(surnameMatches('スズキイチロウ', [''], null)).toBe(false);
  });
  it('長音（ー・ｰ・-）のゆれをそろえる', () => {
    expect(surnameMatches('ｵｰﾉﾊﾅｺ', ['オーノ'], null)).toBe(true);
    expect(surnameMatches('ｵ-ﾉﾊﾅｺ', ['オーノ'], null)).toBe(true);
  });
  it('「振り込みました」の名義の頭の番号と区切りは、Task 4 と同じ並びで外す（全角の番号・長音の区切りも）', () => {
    expect(surnameMatches('ヤマダハナコ', ['スズキ'], '４８２３ーヤマダ ハナコ')).toBe(true);
    expect(surnameMatches('ヤマダハナコ', ['スズキ'], '4823/ヤマダハナコ')).toBe(true);
  });
});
describe('「振り込みました」の印と作品を足したあとの差額', () => {
  it('印の額と同じでも、今の残りより少なければ short（自動にしない）', () => {
    const h = H({ view: 'tentative', remaining: 32500, told: { date: '2026-12-15', name: 'ヤマダ ハナコ', amount: 26500 } });
    expect(kind(R({ amount: 26500, remainingOfRow: 26500 }), [h])).toMatchObject({ auto: false, reviewKind: 'short', householdId: 1 });
    expect(candidatesFor(R({ amount: 26500, remainingOfRow: 26500, rowDate: '2026-12-16' }), [h]).list[0].why).toContain('told');
  });
});
