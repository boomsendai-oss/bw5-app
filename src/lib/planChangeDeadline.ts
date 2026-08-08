// プラン変更・休会の締切計算（会員向けガイド /guide/plan-change 用）。
//
// BOOMのルール（正本: faq_entries「プラン変更(コース変更)はどうすればいい？」）:
//   月会費が前払いのため、締切は毎月10日。
//   10日までの手続き → 翌月から適用 / 11日以降の手続き → 翌々月から適用
//
// 「いつまでにプラン変更すればいい」はFAQボットの最頻質問(実ログ監査#3で5回)。
// 会員が自分で今日の日付と照らし合わせなくて済むよう、結論まで計算して出す。
//
// 判定は必ずJST基準。Vercelの実行環境はUTCのため、JST朝9時前に素の Date を使うと
// 前日扱いになり、10日/11日の境界で答えが1日ズレる（dateJst.ts のM8〜M11と同じ事故）。

import { todayJst } from './dateJst';

/** プラン変更の締切日（毎月この日まで＝当日を含む） */
export const PLAN_CHANGE_DEADLINE_DAY = 10;

export type PlanChangeTiming = {
  /** 今日の日付(JST) 'YYYY-MM-DD' */
  today: string;
  /** 今月の締切日 'YYYY-MM-DD'（毎月10日） */
  deadline: string;
  /** 今日が締切日以前か（10日=true, 11日=false） */
  inTime: boolean;
  /**
   * 締切まであと何日か。締切当日は 0、締切を過ぎていれば null。
   * 「あと2日」の表示に使う。
   */
  daysLeft: number | null;
  /** 今手続きした場合に適用が始まる月 'YYYY-MM' */
  effectiveMonth: string;
  /**
   * 締切を逃した場合に適用が始まる月 'YYYY-MM'（=翌々月）。
   * inTime のときだけ意味を持つ（「過ぎると◯月分から」の警告用）。
   * 締切後は effectiveMonth と同じ値になる。
   */
  missedMonth: string;
};

/**
 * 今手続きすると何月分から変わるかを計算する。
 * now を渡せばテスト可能（既定は現在時刻）。
 */
export function getPlanChangeTiming(now: Date = new Date()): PlanChangeTiming {
  const today = todayJst(now);
  const ym = today.slice(0, 7);
  const day = Number(today.slice(8, 10));

  const deadline = `${ym}-${String(PLAN_CHANGE_DEADLINE_DAY).padStart(2, '0')}`;
  const inTime = day <= PLAN_CHANGE_DEADLINE_DAY;

  return {
    today,
    deadline,
    inTime,
    daysLeft: inTime ? PLAN_CHANGE_DEADLINE_DAY - day : null,
    effectiveMonth: addMonths(ym, inTime ? 1 : 2),
    missedMonth: addMonths(ym, 2),
  };
}

/** 'YYYY-MM' を N ヶ月ずらす（年跨ぎ対応）。 */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  // 月インデックスの正規化はDateに任せる（12月+1 → 翌年1月）
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → '9月'。年をまたぐ場合だけ '2027年1月' と年を添える。 */
export function formatMonthLabel(ym: string, baseYm: string): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  const baseYear = Number(baseYm.slice(0, 4));
  return year === baseYear ? `${month}月` : `${year}年${month}月`;
}

/** 'YYYY-MM-DD' → '8月10日'。 */
export function formatDayLabel(isoDate: string): string {
  return `${Number(isoDate.slice(5, 7))}月${Number(isoDate.slice(8, 10))}日`;
}
