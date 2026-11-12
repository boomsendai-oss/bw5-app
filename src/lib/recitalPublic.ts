// BW6 発表会の家庭向けの表示（純関数。DB にさわらない）。
// 表示の言葉（金額・日付）・短い5行（R-35）・料金の早見の数・表示用の受付の状態・決まった文。
// 曜日は日付から出す（暗算しない）。金額は料金の規則から expectedCharges で出す（式を書き写さない）。

import { jstToMs, type EntryPhase, type RecitalSettings } from './recital';
import { expectedCharges, type FeePerson, type FeeRule } from './recitalFee';
import { weekdayJst } from './dateJst';

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 26500 → '26,500円' */
export function yenJa(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`;
}

/** 先頭10文字の 'YYYY-MM-DD' を [月, 日, 曜日] に */
function mdw(ymdOrJst: string): [number, number, string] {
  const ymd = ymdOrJst.slice(0, 10);
  const [, m, d] = ymd.split('-').map(Number);
  return [m, d, WEEKDAY_JA[weekdayJst(ymd)]];
}

/** '2027-02-10' → '2月10日（水）'（時刻があっても日付だけ） */
export function jpDate(ymdOrJst: string): string {
  const [m, d, w] = mdw(ymdOrJst);
  return `${m}月${d}日（${w}）`;
}

/** '2027-01-31 23:59' → '1/31（日）' */
export function slashDate(ymdOrJst: string): string {
  const [m, d, w] = mdw(ymdOrJst);
  return `${m}/${d}（${w}）`;
}

/** '2027-01-31 23:59' → '1/31（日）23:59' */
export function slashDateTime(jst: string): string {
  return `${slashDate(jst)}${jst.slice(11, 16)}`;
}

/** '2026-12-15 12:00' → '12月15日（火）12時'、'12:30' なら '12時30分' */
export function jpOpenLabel(jst: string): string {
  const h = Number(jst.slice(11, 13));
  const mi = Number(jst.slice(14, 16));
  return `${jpDate(jst)}${h}時${mi === 0 ? '' : `${mi}分`}`;
}

/** 短い5行（04 4-2・R-35）。発表会のページ・ご案内・マイページで同じ文を出す */
export function fiveLines(s: RecitalSettings): string[] {
  return [
    'お申し込みのときは、お支払いはありません。送ると「仮受付」になります。',
    `お支払いは、お申し込みのすぐあとから ${jpDate(s.pay_due)}まで、いつでもできます。カードか銀行振込です。お支払いいただいた時点で「申込完了」です。`,
    `${slashDate(s.change_close_at)}までは、マイページで作品を足したり、やめたりできます。「まだ迷っている」でも申し込めます。迷っている作品がある方は、決まってからお支払いください。`,
    'お支払いのあとに作品を足したときは、足した分だけを、同じ「払う」からお支払いください。',
    'お支払いのあとは、お返しできません。スクールの都合で作品がなくなったときは、その分をお返しします。',
  ];
}

export type FeeTableData = {
  first: number[];
  familyFirst: number;
  familyAdd: number;
  examples: { label: string; total: number }[];
};

/** 作り物の世帯（人ごとの作品の数）の合計。expectedCharges の合計を読むだけ */
function householdTotal(rules: FeeRule[], works: number[]): number {
  const people: FeePerson[] = works.map((n, i) => ({ personId: i + 1, seq: i + 1, feeClass: null, counted: n, extraWorks: [] }));
  return expectedCharges(rules, people, null).total;
}

/** 料金の早見の数（04 4-2）。1人目の1〜maxWorks 作品・家族2人目・家族の例 */
export function feeTableFromRules(rules: FeeRule[], maxWorks: number): FeeTableData {
  const first = Array.from({ length: Math.max(0, maxWorks) }, (_, i) => householdTotal(rules, [i + 1]));
  const one = householdTotal(rules, [1]);
  const twoByOne = householdTotal(rules, [1, 1]);
  const twoAndOne = householdTotal(rules, [2, 1]);
  return {
    first,
    familyFirst: twoByOne - one,
    familyAdd: twoAndOne - twoByOne,
    examples: [
      { label: '2人が1作品ずつ', total: twoByOne },
      { label: '兄2作品・妹1作品', total: twoAndOne },
      { label: '3人が1作品ずつ', total: householdTotal(rules, [1, 1, 1]) },
      { label: '4人が1作品ずつ', total: householdTotal(rules, [1, 1, 1, 1]) },
    ],
  };
}

/**
 * 表示用の受付の状態（表示だけ。送る判定は申込のサーバ処理が本物の状態で行う）。
 * 試し用の鍵が合えば 'open'。止めていても開ける時刻の前なら 'before'
 * （本番は受付開始の前ずっと suspended=1 なので、その間に開いた家庭に「止めています」と出さないため）。
 */
export function publicPhase(real: EntryPhase, preview: boolean, nowMs: number, s: RecitalSettings): EntryPhase {
  if (preview) return 'open';
  if (real === 'suspended' && nowMs < jstToMs(s.entry_open_at)) return 'before';
  return real;
}

/** R-38。段階1は「家族を足す」が無いので、いつも出す */
export const FAMILY_ADD_LINE = 'ご家族を足したいときは、12月22日（火）から、マイページでできます。お急ぎのときは、公式LINEへ。';

/** 連打よけと混んだ時の文（R-33） */
export const RECITAL_MSG: { rate: string; busy: string } = {
  rate: '少し時間をおいて、もう一度お試しください。',
  busy: 'ただいま混み合っています。もう一度『送る』を押してください。二重にはなりません。',
};
