/**
 * 単発イベント(WS・練習会など)の損益分岐人数を、実データから計算する。
 *
 * 背景: 2026-09-01、SHOKO WSの損益分岐をClaudeが「概算」で8名と答えたが、
 * 正しくは10名だった(TARO指摘)。studios.hourly_rate に GOAT ¥3,000/h が
 * 入っており、開催時間も分かっていたのに、引かずに目分量で出したのが原因。
 * データがあるものを推定しないための計算器。
 */

export type EventCost = {
  /** 講師ギャラ・出演料など、人数に関係なく出る固定費 */
  fixedCosts: { label: string; amount: number }[];
  /** 会場: 時間単価 × 時間。会場が実費(公共施設等)なら hourlyRate に実額/hours を入れず venueFlat を使う */
  venue?: { hourlyRate: number; hours: number } | { flat: number };
  /** 参加費(1人あたり・税込) */
  feePerPerson: number;
  /** 1人あたり変動費(資料代・保険など)。無ければ0 */
  variableCostPerPerson?: number;
};

export type BreakEven = {
  /** 固定費の合計(会場費を含む) */
  totalFixed: number;
  /** 1人あたりの粗利 */
  marginPerPerson: number;
  /** 損益分岐に必要な人数(端数は切り上げ) */
  breakEvenCount: number;
  /** 内訳(説明用) */
  lines: { label: string; amount: number }[];
};

function venueAmount(v: EventCost['venue']): { amount: number; label: string } | null {
  if (!v) return null;
  if ('flat' in v) return { amount: v.flat, label: '会場費' };
  // 30分単位で借りることがあるので端数時間をそのまま掛ける(1.5h → ¥4,500)
  return {
    amount: Math.round(v.hourlyRate * v.hours),
    label: `会場費(¥${v.hourlyRate.toLocaleString()}/h × ${v.hours}h)`,
  };
}

export function calcBreakEven(cost: EventCost): BreakEven {
  const lines: { label: string; amount: number }[] = [...cost.fixedCosts];
  const v = venueAmount(cost.venue);
  if (v) lines.push({ label: v.label, amount: v.amount });

  const totalFixed = lines.reduce((s, l) => s + l.amount, 0);
  const marginPerPerson = cost.feePerPerson - (cost.variableCostPerPerson ?? 0);

  if (marginPerPerson <= 0) {
    // 参加費より1人あたりコストが高い = 何人来ても回収できない
    return { totalFixed, marginPerPerson, breakEvenCount: Infinity, lines };
  }
  return {
    totalFixed,
    marginPerPerson,
    breakEvenCount: Math.ceil(totalFixed / marginPerPerson),
    lines,
  };
}

/** 参加人数を入れたときの損益 */
export function calcEventProfit(cost: EventCost, attendees: number): number {
  const { totalFixed, marginPerPerson } = calcBreakEven(cost);
  return marginPerPerson * attendees - totalFixed;
}
