// src/lib/acquisitionFunnel.ts — 集客ファネルの集計 (WS AA / 2026-07-27)
//
// 分母は「来店みなしの体験」(キャンセル・ノーショー・未消化を除く)。
// 分子は突合済みの入会 (enrolled_after=1)。
// 月次の帰属は入会日ではなく *体験日* の月にする。施策を打った月に効果を帰属させるため。

import {
  hasParsableTrialDate,
  isTrialDenominator,
  resolveAttendance,
  type AttendanceInput,
} from './trialAttendance';
import { normalizeReferral, REFERRAL_CHANNELS, type ReferralChannel } from './referralSource';

export type FunnelTrialRow = AttendanceInput & {
  enrolled_after: number;
  referral_source: string | null;
};

export type MonthlyFunnelRow = {
  ym: string;
  trials: number;
  enrolled: number;
  canceled: number;
  noshow: number;
  /** 分母0のときは null (0%と区別する) */
  cvr: number | null;
};

export type ReferralBreakdownRow = {
  channel: ReferralChannel;
  trials: number;
  enrolled: number;
  cvr: number | null;
};

function ratio(enrolled: number, trials: number): number | null {
  return trials > 0 ? enrolled / trials : null;
}

export function buildMonthlyFunnel(rows: FunnelTrialRow[], todayJstStr: string): MonthlyFunnelRow[] {
  const acc = new Map<string, MonthlyFunnelRow>();
  for (const r of rows) {
    // 月バケットは reserved_at から作るため、日付が信用できない行はここで落とす。
    // resolveAttendance はキャンセル/ノーショーを日付検証より先に返すので、
    // その分岐に頼ると '2026-7-1'+キャンセル が '2026-7-' という壊れた月を作ってしまう。
    if (!hasParsableTrialDate(r.reserved_at)) continue;
    const att = resolveAttendance(r, todayJstStr);
    if (att === '予約済') continue; // まだ結果が出ていない予約は集計しない
    const ym = (r.reserved_at ?? '').slice(0, 7);
    if (!ym) continue;
    let cur = acc.get(ym);
    if (!cur) {
      cur = { ym, trials: 0, enrolled: 0, canceled: 0, noshow: 0, cvr: null };
      acc.set(ym, cur);
    }
    if (att === 'キャンセル') cur.canceled += 1;
    else if (att === 'ノーショー') cur.noshow += 1;
    else {
      cur.trials += 1;
      if (Number(r.enrolled_after) === 1) cur.enrolled += 1;
    }
  }
  const out = [...acc.values()].sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
  for (const r of out) r.cvr = ratio(r.enrolled, r.trials);
  return out;
}

// 完了した体験(来店)のみを数える。キャンセル・ノーショーは経路ごとに集計しないため、
// この表の合計は月次表の trials + canceled + noshow とは意図的に一致しない。
export function buildReferralBreakdown(
  rows: FunnelTrialRow[],
  todayJstStr: string
): ReferralBreakdownRow[] {
  const acc = new Map<ReferralChannel, { trials: number; enrolled: number }>();
  for (const r of rows) {
    if (!isTrialDenominator(r, todayJstStr)) continue;
    const ch = normalizeReferral(r.referral_source);
    const cur = acc.get(ch) ?? { trials: 0, enrolled: 0 };
    cur.trials += 1;
    if (Number(r.enrolled_after) === 1) cur.enrolled += 1;
    acc.set(ch, cur);
  }
  // 表示順は REFERRAL_CHANNELS に従う。体験0件の経路は行に出さない。
  return REFERRAL_CHANNELS.flatMap((ch) => {
    const v = acc.get(ch);
    if (!v || v.trials === 0) return [];
    return [{ channel: ch, trials: v.trials, enrolled: v.enrolled, cvr: ratio(v.enrolled, v.trials) }];
  });
}
