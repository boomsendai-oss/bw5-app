// BW6 発表会（段階1）の料金。料金の規則→今あるべき請求の行・「1人目」の選び方・生きている行との比べ・検算。
// 純関数。DB にさわらない。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 規則は設計書 03 3-4 の規則の表（段階1は item_code が base／tshirt／coop_ticket／add_work の4種類）。

import type { FeeClass } from './recital';

export type FeeRule = {
  payer_role: 'first' | 'family';
  item_code: 'base' | 'tshirt' | 'coop_ticket' | 'add_work';
  nth_from: number;
  nth_to: number | null;
  unit_amount: number;
  qty: number;
  label: string;
  is_tentative: number;
  sort_order: number;
};

/** counted＝お金に数える出演の数（isCountedCast が true の数）。extraWorks＝別料金の作品（呼ぶ側が作る） */
export type FeePerson = {
  personId: number;
  seq: number;
  feeClass: FeeClass;
  counted: number;
  extraWorks: { workCode: string; label: string; fee: number }[];
};

export type ChargeLine = {
  personId: number | null;
  itemCode: string;
  ref: string;
  label: string;
  qty: number;
  unitAmount: number;
  amount: number;
};

const STAGE1_ITEM_CODES: readonly string[] = ['base', 'tshirt', 'coop_ticket', 'add_work'];

/** 段階1の4種類以外の規則が来たら止める（後の段階の種類を黙って落とさない） */
function assertStage1Rules(rules: FeeRule[]): void {
  for (const r of rules) {
    if (!STAGE1_ITEM_CODES.includes(r.item_code)) {
      throw new Error(`recitalFee: 段階1で扱えない料金の規則です（item_code=${String(r.item_code)}）`);
    }
  }
}

/** sort_order の順（同じなら元の並び） */
function sortedRules(rules: FeeRule[]): FeeRule[] {
  return rules.map((r, i) => ({ r, i })).sort((a, b) => a.r.sort_order - b.r.sort_order || a.i - b.i).map((x) => x.r);
}

function ruleLine(personId: number | null, r: FeeRule, ref: string, label: string): ChargeLine {
  return { personId, itemCode: r.item_code, ref, label, qty: r.qty, unitAmount: r.unit_amount, amount: r.qty * r.unit_amount };
}

function isCandidate(p: FeePerson): boolean {
  return p.counted >= 1 && p.feeClass !== 'tshirt_only' && p.feeClass !== 'free';
}

/** 1人分の行。isFirst なら世帯の行 coop_ticket も、その人の行の中の規則の位置に入れる */
function personLines(sorted: FeeRule[], p: FeePerson, isFirst: boolean): ChargeLine[] {
  const n = p.counted;
  if (p.feeClass === 'free') return [];
  if (p.feeClass === 'tshirt_only') {
    if (n < 1) return [];
    const t = sorted.find((r) => r.payer_role === 'family' && r.item_code === 'tshirt');
    return t ? [ruleLine(p.personId, t, '', t.label)] : [];
  }
  const role = isFirst ? 'first' : 'family';
  const lines: ChargeLine[] = [];
  for (const r of sorted) {
    if (r.payer_role !== role) continue;
    if (r.item_code === 'base' || r.item_code === 'tshirt') {
      if (r.nth_from <= n) lines.push(ruleLine(p.personId, r, '', r.label));
    } else if (r.item_code === 'add_work') {
      const to = Math.min(r.nth_to ?? Infinity, n);
      for (let k = Math.max(r.nth_from, 2); k <= to; k++) lines.push(ruleLine(p.personId, r, String(k), `${k}作品目`));
    } else if (r.item_code === 'coop_ticket') {
      if (isFirst && p.feeClass !== 'no_coop') lines.push(ruleLine(null, r, '', r.label));
    }
  }
  for (const w of p.extraWorks) {
    lines.push({ personId: p.personId, itemCode: 'extra_work', ref: w.workCode, label: w.label, qty: 1, unitAmount: w.fee, amount: w.fee });
  }
  return lines;
}

/** 1人目を決めたうえでの世帯の行（1人目が先、ほかは seq の順） */
function householdLines(sorted: FeeRule[], people: FeePerson[], firstPersonId: number | null): ChargeLine[] {
  const first = people.find((p) => p.personId === firstPersonId) ?? null;
  const others = people.filter((p) => p !== first).sort((a, b) => a.seq - b.seq);
  const lines: ChargeLine[] = first ? personLines(sorted, first, true) : [];
  for (const p of others) lines.push(...personLines(sorted, p, false));
  return lines;
}

const sumAmounts = (lines: ChargeLine[]): number => lines.reduce((a, l) => a + l.amount, 0);

function pickFirstSorted(sorted: FeeRule[], people: FeePerson[], currentFirstPersonId: number | null): number | null {
  const candidates = people.filter(isCandidate);
  if (candidates.length === 0) return null;
  const totals = candidates.map((c) => ({ c, total: sumAmounts(householdLines(sorted, people, c.personId)) }));
  const min = Math.min(...totals.map((t) => t.total));
  const cheapest = totals.filter((t) => t.total === min).map((t) => t.c);
  const current = cheapest.find((c) => c.personId === currentFirstPersonId);
  if (current) return current.personId;
  return cheapest.reduce((a, b) => (b.seq < a.seq ? b : a)).personId;
}

/** 1人目（R-83）：候補を1人ずつ1人目に置いた世帯の合計が最小の人。同じ額なら今の1人目、いなければ seq の小さい人 */
export function pickFirstPerson(rules: FeeRule[], people: FeePerson[], currentFirstPersonId: number | null): number | null {
  assertStage1Rules(rules);
  return pickFirstSorted(sortedRules(rules), people, currentFirstPersonId);
}

/** 今あるべき請求の行。lines の順のまま INSERT する（7 の試験が ORDER BY id でくらべる） */
export function expectedCharges(
  rules: FeeRule[],
  people: FeePerson[],
  currentFirstPersonId: number | null,
): { lines: ChargeLine[]; firstPersonId: number | null; total: number } {
  assertStage1Rules(rules);
  const sorted = sortedRules(rules);
  const firstPersonId = pickFirstSorted(sorted, people, currentFirstPersonId);
  const lines = householdLines(sorted, people, firstPersonId);
  return { lines, firstPersonId, total: sumAmounts(lines) };
}

const lineKey = (l: ChargeLine): string => `${l.personId ?? ''}|${l.itemCode}|${l.ref}`;

/** 生きている行と期待の行の比べ。adjust にはさわらない。label のちがいは見ない */
export function diffCharges(active: (ChargeLine & { id: number })[], expected: ChargeLine[]): { add: ChargeLine[]; voidIds: number[] } {
  const matched = new Set<number>();
  const keptKeys = new Set<string>();
  const voidIds: number[] = [];
  for (const a of active) {
    if (a.itemCode === 'adjust') continue;
    const k = lineKey(a);
    const idx = keptKeys.has(k) ? -1 : expected.findIndex((e, i) => !matched.has(i) && lineKey(e) === k && e.amount === a.amount);
    if (idx >= 0) {
      matched.add(idx);
      keptKeys.add(k);
    } else {
      voidIds.push(a.id);
    }
  }
  return { add: expected.filter((_, i) => !matched.has(i)), voidIds };
}

/** 検算：規則から出した額が早見表（fee_check_first・fee_check_family）と合うか */
export function feeCheck(rules: FeeRule[], checkFirst: number[], checkFamily: number): { ok: boolean; first: number[]; family: number; tentative: boolean } {
  const person = (id: number, n: number): FeePerson => ({ personId: id, seq: id, feeClass: null, counted: n, extraWorks: [] });
  const totalOf = (people: FeePerson[]) => expectedCharges(rules, people, null).total;
  const first = checkFirst.map((_, i) => totalOf([person(1, i + 1)]));
  const family = totalOf([person(1, 1), person(2, 1)]) - totalOf([person(1, 1)]);
  const tentative = rules.some((r) => r.is_tentative === 1);
  const sameFirst = first.length === checkFirst.length && first.every((v, i) => v === checkFirst[i]);
  return { ok: sameFirst && family === checkFamily && !tentative, first, family, tentative };
}
