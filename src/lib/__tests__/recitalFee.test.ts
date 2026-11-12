import { describe, it, expect } from 'vitest';
import { expectedCharges, pickFirstPerson, diffCharges, feeCheck, type FeeRule, type FeePerson, type ChargeLine } from '../recitalFee';
import { moneySummary } from '../recital';
import type { FeeClass } from '../recital';

const R = (payer_role: 'first' | 'family', item_code: FeeRule['item_code'], nth_from: number, nth_to: number | null, unit_amount: number, qty: number, label: string, sort_order: number): FeeRule =>
  ({ payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative: 0, sort_order });
const RULES: FeeRule[] = [
  R('first', 'base', 1, 1, 16000, 1, '出演料（本体）', 1),
  R('first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 2),
  R('first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚', 3),
  R('first', 'add_work', 2, 2, 6000, 1, '2作品目', 4),
  R('first', 'add_work', 3, null, 3000, 1, '3作品目から（1作品ごと）', 5),
  R('family', 'base', 1, 1, 5000, 1, 'ご家族の参加費', 6),
  R('family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ', 7),
  R('family', 'add_work', 2, null, 3000, 1, '2作品目から（1作品ごと）', 8),
];
const P = (id: number, n: number, feeClass: FeeClass = null, extra: number[] = []): FeePerson =>
  ({ personId: id, seq: id, feeClass, counted: n, extraWorks: extra.map((fee, i) => ({ workCode: `W9${i}`, label: '別料金の作品', fee })) });
const total = (people: FeePerson[], cur: number | null = null) => expectedCharges(RULES, people, cur).total;
const key = (l: ChargeLine) => `${l.personId ?? ''}|${l.itemCode}|${l.ref}|${l.amount}`;
/** 生きている行に diff を当てた結果（試験用の小さな台帳） */
function applyDiff(active: (ChargeLine & { id: number })[], expected: ChargeLine[]) {
  const d = diffCharges(active, expected);
  let next = Math.max(0, ...active.map((a) => a.id)) + 1;
  return { d, active: [...active.filter((a) => !d.voidIds.includes(a.id)), ...d.add.map((l) => ({ ...l, id: next++ }))] };
}

describe('料金の例（05 5-1 の表の全行）', () => {
  it.each([
    ['1人・1作品', [P(1, 1)], 26500],
    ['1人・2作品', [P(1, 2)], 32500],
    ['1人・3作品', [P(1, 3)], 35500],
    ['1人・4作品', [P(1, 4)], 38500],
    ['1人・5作品', [P(1, 5)], 41500],
    ['1人・1作品＋迷っている1作品（迷っているは n に入らない）', [P(1, 1)], 26500],
    ['きょうだい2人・1作品ずつ', [P(1, 1), P(2, 1)], 34500],
    ['きょうだい3人・1作品ずつ', [P(1, 1), P(2, 1), P(3, 1)], 42500],
    ['きょうだい4人・1作品ずつ', [P(1, 1), P(2, 1), P(3, 1), P(4, 1)], 50500],
    ['兄2作品・妹1作品', [P(1, 2), P(2, 1)], 37500],
    ['兄3作品・妹1作品', [P(1, 3), P(2, 1)], 40500],
    ['兄2作品・妹2作品', [P(1, 2), P(2, 2)], 43500],
    ['兄3作品・妹2作品', [P(1, 3), P(2, 2)], 46500],
    ['兄5作品・妹5作品', [P(1, 5), P(2, 5)], 61500],
    ['きょうだい3人（1・2・3作品）', [P(1, 1), P(2, 2), P(3, 3)], 51500],
    ['きょうだい3人・2作品ずつ', [P(1, 2), P(2, 2), P(3, 2)], 54500],
    ['きょうだい3人・5作品ずつ', [P(1, 5), P(2, 5), P(3, 5)], 81500],
    ['協力チケットなし・1人1作品', [P(1, 1, 'no_coop')], 19000],
    ['協力チケットなし・1人2作品', [P(1, 2, 'no_coop')], 25000],
    ['協力チケットなし（印の人が1人目）・兄1・妹1', [P(1, 1, 'no_coop'), P(2, 1)], 27000],
    ['Tシャツ代だけ・1人', [P(1, 1, 'tshirt_only')], 3000],
    ['参加費なし（0円）・1人', [P(1, 1, 'free')], 0],
    ['参加費なしの親＋ふつうの子1作品', [P(1, 1, 'free'), P(2, 1)], 26500],
    ['Tシャツ代だけの親＋ふつうの子1作品', [P(1, 1, 'tshirt_only'), P(2, 1)], 29500],
    ['参加費なしの人とTシャツ代だけの人の世帯', [P(1, 1, 'free'), P(2, 1, 'tshirt_only')], 3000],
    ['1作品＋別料金の作品1つ', [P(1, 1, null, [4000])], 30500],
    ['別料金の作品だけ', [P(1, 0, null, [4000])], 4000],
    ['MOCCHIN だけ（separate は渡さない）', [P(1, 0)], 0],
  ] as const)('%s → %i', (_n, people, want) => expect(total([...people])).toBe(want));

  it('12/20 の例の行（本体・Tシャツ・協力チケット・2作品目）', () => {
    const r = expectedCharges(RULES, [P(1, 2)], null);
    expect(r.lines.map(key).sort()).toEqual(['1|add_work|2|6000', '1|base||16000', '1|tshirt||3000', '|coop_ticket||7500'].sort());
    expect(r.lines.find((l) => l.itemCode === 'add_work')?.label).toBe('2作品目');
  });
  it('参加費なしの人とTシャツ代だけの人の世帯には協力チケットの行が無く、1人目も無い', () => {
    const r = expectedCharges(RULES, [P(1, 1, 'free'), P(2, 1, 'tshirt_only')], null);
    expect(r.firstPersonId).toBeNull();
    expect(r.lines.some((l) => l.itemCode === 'coop_ticket')).toBe(false);
  });
});

describe('1人目（05 5-2・R-83）', () => {
  it('兄2・妹1 は妹が1人目（37,500 と 40,500 の安い方）', () => {
    expect(pickFirstPerson(RULES, [P(1, 2), P(2, 1)], null)).toBe(2);
  });
  it('同じ額なら今の1人目のまま。初めてなら P番号の小さい人', () => {
    expect(pickFirstPerson(RULES, [P(1, 3), P(2, 2)], 2)).toBe(2);
    expect(pickFirstPerson(RULES, [P(1, 3), P(2, 2)], 1)).toBe(1);
    expect(pickFirstPerson(RULES, [P(1, 3), P(2, 2)], null)).toBe(1);
    expect(total([P(1, 3), P(2, 2)], 2)).toBe(total([P(1, 3), P(2, 2)], 1));
  });
  it('今の1人目がいちばん安い人の中にいなければ入れかわる（足す例：兄2 → 兄2・妹1）', () => {
    expect(expectedCharges(RULES, [P(1, 2), P(2, 1)], 1).firstPersonId).toBe(2);
  });
});

describe('計算の部品の試し（05 5-1 の21場面）', () => {
  it('1 n が0の人だけの世帯：行なし', () => {
    expect(expectedCharges(RULES, [P(1, 0)], null)).toEqual({ lines: [], firstPersonId: null, total: 0 });
  });
  it('2 1人目がやめて2人目が残る：行ごとに void と足す（Tシャツと協力チケットは残る）', () => {
    const start = expectedCharges(RULES, [P(1, 1), P(2, 1)], null).lines.map((l, i) => ({ ...l, id: i + 1 }));
    const exp = expectedCharges(RULES, [P(1, 0), P(2, 1)], 1);
    const { d, active } = applyDiff(start, exp.lines);
    expect(exp.firstPersonId).toBe(2);
    expect(d.add.map(key)).toEqual(['2|base||16000']);
    expect(d.voidIds.map((id) => key(start.find((s) => s.id === id)!)).sort()).toEqual(['1|base||16000', '1|tshirt||3000', '2|base||5000'].sort());
    expect(active.reduce((a, l) => a + l.amount, 0)).toBe(26500);
  });
  it('3 家族のうち1人だけ n が0になる：37,500 → 26,500', () => {
    expect(total([P(1, 2), P(2, 1)])).toBe(37500);
    expect(total([P(1, 0), P(2, 1)])).toBe(26500);
  });
  it('4 払ったあとにやめた作品がある：お支払いずみの分が出る', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 2)])], paymentAmounts: [35500], refundTodoAmounts: [] }))
      .toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });
  });
  it('5 払ったあとに足した：残りは差額だけ', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 2)])], paymentAmounts: [26500], refundTodoAmounts: [] }).remaining).toBe(6000);
  });
  it('6 お支払いずみの分がある世帯が足した：先に当たる', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 3)])], paymentAmounts: [35500], refundTodoAmounts: [] }))
      .toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });
  });
  it('7 返す分（todo）がある世帯の残り', () => {
    expect(moneySummary({ chargeAmounts: [26500], paymentAmounts: [32500], refundTodoAmounts: [6000] }))
      .toEqual({ total: 26500, paid: 26500, remaining: 0, overpaid: 0 });
  });
  it('8・9 dropped の作品・まだ迷っている作品は n に入らない（呼ぶ側が isCountedCast で数えた n）', () => {
    expect(total([P(1, 1)])).toBe(26500);
  });
  it('10 特別な料金の印の人がいる（上の表の no_coop・tshirt_only・free の行）', () => {
    expect(total([P(1, 1, 'no_coop'), P(2, 1)])).toBe(27000);
  });
  it('11 同じ額のとき1人目が動かない（diff が空）', () => {
    const lines = expectedCharges(RULES, [P(1, 3), P(2, 2)], 2).lines.map((l, i) => ({ ...l, id: i + 1 }));
    expect(diffCharges(lines, expectedCharges(RULES, [P(1, 3), P(2, 2)], 2).lines)).toEqual({ add: [], voidIds: [] });
  });
  it('12 別料金と通常がまざる', () => { expect(total([P(1, 1, null, [4000]), P(2, 1)])).toBe(38500); });
  it('13 家族4人', () => { expect(total([P(1, 1), P(2, 1), P(3, 1), P(4, 1)])).toBe(50500); });
  it('14 払ったあとに種類を変えた（下がる・上がる）', () => {
    expect(moneySummary({ chargeAmounts: [total([P(1, 1, 'no_coop')])], paymentAmounts: [26500], refundTodoAmounts: [] }).overpaid).toBe(7500);
    expect(moneySummary({ chargeAmounts: [total([P(1, 1)])], paymentAmounts: [19000], refundTodoAmounts: [] }).remaining).toBe(7500);
  });
  it('15・16 同じ種類をもう一度選んだ／印のある人を会員と結んだ：何も変わらない', () => {
    const lines = expectedCharges(RULES, [P(1, 1, 'no_coop')], null).lines.map((l, i) => ({ ...l, id: i + 1 }));
    expect(diffCharges(lines, expectedCharges(RULES, [P(1, 1, 'no_coop')], 1).lines)).toEqual({ add: [], voidIds: [] });
  });
  it('17 きょうだいの世帯で種類を変えた（1人目が入れかわる）', () => {
    expect(expectedCharges(RULES, [P(1, 2), P(2, 1)], null).firstPersonId).toBe(2);
    const r = expectedCharges(RULES, [P(1, 2), P(2, 1, 'tshirt_only')], 2);
    expect([r.firstPersonId, r.total]).toEqual([1, 35500]);
  });
  it('18 種類を変えた人があとで作品を足す・全部やめる', () => {
    expect(total([P(1, 2, 'no_coop')])).toBe(25000);
    expect(total([P(1, 0, 'no_coop')])).toBe(0);
  });
  it('19 「ふつう」にもどした', () => { expect(total([P(1, 1)])).toBe(26500); });
  it('20 adjust の下げる行がある世帯が全部やめた：adjust は残り、合計は0', () => {
    const active = [{ personId: null, itemCode: 'adjust', ref: '', label: '手の調整', qty: 1, unitAmount: -5000, amount: -5000, id: 9 },
      ...expectedCharges(RULES, [P(1, 1)], null).lines.map((l, i) => ({ ...l, id: i + 1 }))];
    const { d, active: after } = applyDiff(active, expectedCharges(RULES, [P(1, 0)], 1).lines);
    expect(d.voidIds).not.toContain(9);
    expect(after.map((a) => a.id)).toEqual([9]);
    expect(moneySummary({ chargeAmounts: after.map((a) => a.amount), paymentAmounts: [], refundTodoAmounts: [] }).total).toBe(0);
  });
});

describe('請求の行の流れ（05 5-3 の例・12/20〜1/30）', () => {
  it('行ごとに足す・void して、合計と払った額が表のとおり', () => {
    let active: (ChargeLine & { id: number })[] = [];
    const pays: number[] = [];
    const step = (n: number) => { active = applyDiff(active, expectedCharges(RULES, [P(1, n)], 1).lines).active; };
    const m = () => moneySummary({ chargeAmounts: active.map((a) => a.amount), paymentAmounts: pays, refundTodoAmounts: [] });
    step(2); expect(m()).toEqual({ total: 32500, paid: 0, remaining: 32500, overpaid: 0 });          // 12/20
    pays.push(32500); expect(m().remaining).toBe(0);                                                 // 12/21
    step(3); expect(m()).toEqual({ total: 35500, paid: 32500, remaining: 3000, overpaid: 0 });       // 1/20
    expect(active.some((a) => a.itemCode === 'add_work' && a.ref === '3' && a.label === '3作品目')).toBe(true);
    pays.push(3000); expect(m().remaining).toBe(0);                                                  // 1/22
    step(2); expect(m()).toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });       // 1/25
    step(3); expect(m()).toEqual({ total: 35500, paid: 35500, remaining: 0, overpaid: 0 });          // 1/30
  });
});

describe('検算（05 5-1）', () => {
  it('BW6 の規則は 26,500〜41,500 と 8,000 で合う', () => {
    expect(feeCheck(RULES, [26500, 32500, 35500, 38500, 41500], 8000))
      .toEqual({ ok: true, first: [26500, 32500, 35500, 38500, 41500], family: 8000, tentative: false });
  });
  it('規則が1つちがえば ng', () => {
    const bad = RULES.map((r) => (r.item_code === 'add_work' && r.nth_from === 2 && r.payer_role === 'first' ? { ...r, unit_amount: 5000 } : r));
    expect(feeCheck(bad, [26500, 32500, 35500, 38500, 41500], 8000).ok).toBe(false);
  });
  it('is_tentative の行があれば、額が合っても ng', () => {
    const t = RULES.map((r, i) => (i === 0 ? { ...r, is_tentative: 1 } : r));
    expect(feeCheck(t, [26500, 32500, 35500, 38500, 41500], 8000)).toMatchObject({ ok: false, tentative: true });
  });
});
