// カレンダー実績と lesson_master の予定枠を突き合わせて、lesson_instances へ
// 何を書くべきかを決める純関数。DBアクセスは持たない(vitest対象)。
// 設計: docs/superpowers/specs/2026-08-28-monthly-close-automation-design.md
//
// なぜ「枠を removed で埋める」必要があるか:
//   payroll-calc / studioBilling は「instanceが無い(master_id,date)」を
//   master 週次展開で埋め戻す。休講の日に instance を作らないでいると、
//   展開が復活させてしまい **休講に給与とスタジオ料が付く**。
//   だから「開催されなかった」ことも明示的に記録する。

import type { ResolvedLesson } from './calendarActuals';

export type MasterSlotLite = {
  master_id: number;
  date: string;
  start_time: string;
  end_time: string;
  instructor_id: number | null;
  studio_id: number | null;
  class_name: string;
};

export type InstanceWrite = {
  master_id: number | null;
  date: string;
  start_time: string;
  end_time: string;
  instructor_id: number | null;
  studio_id: number | null;
  status: 'scheduled' | 'removed';
  note: string;
};

export type DayPlan = {
  keep: InstanceWrite[];        // 開催された(カレンダーの会場・講師で上書き)
  removed: InstanceWrite[];     // 開催されなかった(休講 or そもそも予定が無い)
  extra: InstanceWrite[];       // マスタに無い単発(WS・バトル練習会・代講回など)
  needsReview: ResolvedLesson[]; // 読めなかったもの。**書き込まない**
  skipped: MasterSlotLite[];     // 読めない予定と時間が重なる枠。**触らない**(誤判定で消さない)
};

function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

const MATCH_WINDOW_MIN = 60;

/**
 * 1日ぶんを突き合わせる。
 *
 * マッチ規則: 同じ講師で、開始時刻の差が60分以内。差が小さい順に確定させ、
 * 1つの予定が2つの枠に二重マッチしないようにする。
 * **講師が違えば時刻が近くてもマッチさせない**(他人の枠を奪うと給与が入れ替わるため)。
 *
 * 要確認(issues あり)の予定は keep にも removed にも入れない = **枠に触らない**。
 * 不確かなデータで上書きするのも、勝手に消すのも、どちらも金額事故になるため、
 * 判断を人に残す。
 */
export function reconcileDay(slots: MasterSlotLite[], events: ResolvedLesson[]): DayPlan {
  const plan: DayPlan = { keep: [], removed: [], extra: [], needsReview: [], skipped: [] };

  const usable = events.filter((e) => {
    if (e.issues.length > 0) { plan.needsReview.push(e); return false; }
    return true;
  });

  // (slot, event) の候補を距離つきで作り、近い順に確定
  const pairs: { si: number; ei: number; dist: number }[] = [];
  slots.forEach((s, si) => {
    usable.forEach((e, ei) => {
      if (e.instructor_id !== s.instructor_id) return;
      const d = Math.abs(toMin(e.start) - toMin(s.start_time));
      if (!Number.isFinite(d) || d > MATCH_WINDOW_MIN) return;
      pairs.push({ si, ei, dist: d });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist || a.si - b.si || a.ei - b.ei);

  const slotTaken = new Set<number>();
  const eventTaken = new Set<number>();
  const matched = new Map<number, number>(); // si -> ei
  for (const p of pairs) {
    if (slotTaken.has(p.si) || eventTaken.has(p.ei)) continue;
    slotTaken.add(p.si); eventTaken.add(p.ei); matched.set(p.si, p.ei);
  }

  slots.forEach((s, si) => {
    const ei = matched.get(si);
    if (ei === undefined) {
      // 読めなかった予定と時間が重なる枠は「未開催」と断定できない。
      // その予定こそがこの枠の実績かもしれないので、消さずに人の判断へ回す。
      const ambiguous = plan.needsReview.some(
        (e) => Math.abs(toMin(e.start) - toMin(s.start_time)) <= MATCH_WINDOW_MIN
      );
      if (ambiguous) { plan.skipped.push(s); return; }
      // カレンダーに対応する予定が無い = 開催されなかった
      plan.removed.push({
        master_id: s.master_id, date: s.date, start_time: s.start_time, end_time: s.end_time,
        instructor_id: s.instructor_id, studio_id: s.studio_id, status: 'removed',
        note: 'カレンダーに予定なし(未開催)',
      });
      return;
    }
    const e = usable[ei];
    if (e.cancelled) {
      plan.removed.push({
        master_id: s.master_id, date: s.date, start_time: e.start, end_time: e.end,
        instructor_id: s.instructor_id, studio_id: s.studio_id, status: 'removed',
        note: '休講',
      });
      return;
    }
    // 開催: **会場と時刻はカレンダーの実績で上書き**(週替わり会場・時間変更の反映)
    plan.keep.push({
      master_id: s.master_id, date: s.date, start_time: e.start, end_time: e.end,
      instructor_id: e.instructor_id, studio_id: e.studio_id, status: 'scheduled',
      note: 'カレンダー実績',
    });
  });

  usable.forEach((e, ei) => {
    if (eventTaken.has(ei) || e.cancelled) return;
    plan.extra.push({
      master_id: null, date: e.date, start_time: e.start, end_time: e.end,
      instructor_id: e.instructor_id, studio_id: e.studio_id, status: 'scheduled',
      note: `単発: ${e.class_name}`.slice(0, 120),
    });
  });

  return plan;
}
