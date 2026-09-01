/**
 * 毎月出るはずの固定費（サブスク・通信費など）が、今月だけ計上されていないのを見つける。
 *
 * 背景: リベシティ¥3,300/月が7月・8月と2ヶ月ぶん帳簿から抜けていた(2026-09-01発覚)。
 * 原因は「業務の固定費なのに、支払いがTARO個人のSBIデビットで、
 * 業務口座(GMO)のCSVには載らない」こと。金額が小さく毎月出るものほど、
 * 消えても誰も気づかない。過去に出ていた実績そのものを見張りにする。
 */

export type ExpenseRow = {
  expense_date: string; // YYYY-MM-DD
  description: string | null;
  category: string | null;
  amount: number;
};

export type MissingRecurring = {
  key: string; // 名寄せキー(表示にも使う)
  category: string | null;
  typicalAmount: number; // 直近の中央値
  seenMonths: string[]; // 直近で計上されていた月
  lastSeen: string; // 最後に出た月
};

/**
 * 表記ゆれを吸収して名寄せする。
 * 承認番号・TID・連番(#2)・日付・金額など毎回変わる部分を落とす。
 */
export function normalizeExpenseKey(description: string | null): string {
  if (!description) return '';
  return (
    description
      .replace(/承認番号[:：]\s*\d+/g, '')
      .replace(/TID[:：]\s*\d+/gi, '')
      .replace(/#\d+/g, '')
      .replace(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g, '')
      // 末尾の数字列(請求番号など)は落とすが、名前の一部の数字は残したいので4桁以上のみ
      .replace(/\d{4,}/g, '')
      .replace(/[\s　]+/g, '')
      .toUpperCase()
      .trim()
  );
}

function ymOf(date: string): string {
  return date.slice(0, 7);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** ym の前の月を返す。'2026-01' → '2025-12' */
function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * targetYm に計上されているべきなのに無い固定費を返す。
 *
 * 「固定費」の判定は実績ベース: 直近 lookback ヶ月のうち minMonths ヶ月以上に
 * 同じ名前で出ていれば、毎月出るものとみなす。
 * マスタ登録を人間に強いると登録漏れがそのまま監視漏れになるため、
 * 実績そのものを正とする。
 */
export function findMissingRecurringExpenses(
  rows: ExpenseRow[],
  targetYm: string,
  opts: { lookback?: number; minMonths?: number; maxAmount?: number } = {}
): MissingRecurring[] {
  const lookback = opts.lookback ?? 3;
  const minMonths = opts.minMonths ?? 2;
  // 高額なものは人間が必ず気づく。見張る価値があるのは「小さくて忘れられるもの」。
  const maxAmount = opts.maxAmount ?? 100000;

  // 直近 lookback ヶ月(targetYm は含まない)
  const window: string[] = [];
  let cur = targetYm;
  for (let i = 0; i < lookback; i++) {
    cur = prevYm(cur);
    window.push(cur);
  }

  const byKey = new Map<
    string,
    { months: Map<string, number[]>; category: string | null; label: string }
  >();

  for (const r of rows) {
    const key = normalizeExpenseKey(r.description);
    if (!key) continue;
    const ym = ymOf(r.expense_date);
    if (ym !== targetYm && !window.includes(ym)) continue;
    let e = byKey.get(key);
    if (!e) {
      e = { months: new Map(), category: r.category, label: r.description ?? key };
      byKey.set(key, e);
    }
    const arr = e.months.get(ym) ?? [];
    arr.push(r.amount);
    e.months.set(ym, arr);
  }

  const missing: MissingRecurring[] = [];
  for (const [key, e] of byKey) {
    if (e.months.has(targetYm)) continue; // 今月ある = 問題なし
    const seen = window.filter((m) => e.months.has(m));
    if (seen.length < minMonths) continue; // たまたま数回出ただけのものは対象外

    const amounts = seen.flatMap((m) => e.months.get(m) ?? []);
    const typical = median(amounts);
    if (typical > maxAmount) continue;

    missing.push({
      key: e.label,
      category: e.category,
      typicalAmount: typical,
      seenMonths: [...seen].sort(),
      lastSeen: [...seen].sort().slice(-1)[0],
    });
  }

  // 金額が大きいものから: 帳簿への影響が大きい順に人間の目に入れる
  return missing.sort((a, b) => b.typicalAmount - a.typicalAmount || a.key.localeCompare(b.key));
}
