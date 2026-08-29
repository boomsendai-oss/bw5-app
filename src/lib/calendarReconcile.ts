// カレンダー実績と lesson_master の予定枠を突き合わせて、lesson_instances へ
// 何を書くべきかを決める純関数。DBアクセスは持たない(vitest対象)。
// 設計: docs/superpowers/specs/2026-08-28-monthly-close-automation-design.md
//
// なぜ「枠を removed で埋める」必要があるか:
//   payroll-calc / studioBilling は「instanceが無い(master_id,date)」を
//   master 週次展開で埋め戻す。休講の日に instance を作らないでいると、
//   展開が復活させてしまい **休講に給与とスタジオ料が付く**。
//   だから「開催されなかった」ことも明示的に記録する。

import { sameSite, resolveRoomWithinSite } from './calendarActuals';
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

  // 給与対象外(練習会など)は枠にマッチさせない。会場だけ使うので extra として残す。
  const nonPayable = events.filter((e) => !e.payable && !e.cancelled);
  const usable = events.filter((e) => {
    if (!e.payable) return false;
    if (e.issues.length > 0) { plan.needsReview.push(e); return false; }
    return true;
  });

  // 連名(2人体制)は講師ごとに1件へ展開してから突き合わせる。
  // 給与は各人に各自の単価で付く(TARO¥0 + KOKEKO¥3,500 のように)。
  // 会場時間が人数ぶん二重に乗らないよう、畳むのは集計側(studioBilling)の責務。
  type Expanded = ResolvedLesson & { _instructorId: number | null; _substitute: boolean };
  const expanded: Expanded[] = [];
  for (const e of usable) {
    if (e.instructors.length <= 1) {
      expanded.push({ ...e, _instructorId: e.instructor_id, _substitute: e.substitute });
      continue;
    }
    for (const p of e.instructors) {
      expanded.push({ ...e, _instructorId: p.id, _substitute: p.substitute });
    }
  }

  // (slot, event) の候補を距離つきで作り、会場一致→時刻の近さの順で確定
  const pairs: { si: number; ei: number; dist: number; venueMismatch: number }[] = [];
  slots.forEach((s, si) => {
    expanded.forEach((e, ei) => {
      if (e._instructorId !== s.instructor_id) return;
      const d = Math.abs(toMin(e.start) - toMin(s.start_time));
      if (!Number.isFinite(d) || d > MATCH_WINDOW_MIN) return;
      // 会場が両方読めていて違う場合は劣後させる。同じ講師の枠が同時刻に2つある日
      // (多賀城HOUSEとHOUSEエキスパート)に時刻だけで結ぶと誤った枠が勝ち、
      // override単価が適用されなかった(2026-08-29・TAROの手照合で発覚)。
      // 完全に弾かない理由: 週替わり会場では「枠の既定会場と実際の会場が違う」のが
      // 正常なので、他に候補が無ければ不一致でも結ぶ。
      const venueMismatch =
        e.studio_id != null && s.studio_id != null && e.studio_id !== s.studio_id && !sameSite(e.studio_id, s.studio_id) ? 1 : 0;
      pairs.push({ si, ei, dist: d, venueMismatch });
    });
  });
  pairs.sort((a, b) => a.venueMismatch - b.venueMismatch || a.dist - b.dist || a.si - b.si || a.ei - b.ei);

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
      // 会場が読めていて枠の会場と違うなら、時間が重なっていても別物。
      // (2026-08-28の事故: GOATのバトル練習会がAZUMAの日曜枠と「時間が近い」だけで
      //  曖昧扱いになり、枠が未書き込みのまま master展開に埋め戻されて
      //  **開催していないレッスンに給与が付いた**。「触らない」は中立ではなく
      //  「開催したことにする」だと判明したため、会場で切れるものは切る)
      const ambiguous = plan.needsReview.some((e) => {
        if (Math.abs(toMin(e.start) - toMin(s.start_time)) > MATCH_WINDOW_MIN) return false;
        if (e.studio_id != null && s.studio_id != null && e.studio_id !== s.studio_id) return false;
        return true;
      });
      if (ambiguous) { plan.skipped.push(s); return; }
      // カレンダーに対応する予定が無い = 開催されなかった
      plan.removed.push({
        master_id: s.master_id, date: s.date, start_time: s.start_time, end_time: s.end_time,
        instructor_id: s.instructor_id, studio_id: s.studio_id, status: 'removed',
        note: 'カレンダーに予定なし(未開催)',
      });
      return;
    }
    const e = expanded[ei];
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
      instructor_id: e._instructorId,
      // 同一敷地(GOAT A/B): 総称locationならマスタの部屋、明示ならカレンダーの部屋
      studio_id: resolveRoomWithinSite(e.studio_id, s.studio_id, e.room_explicit), status: 'scheduled',
      note: e.instructors.length > 1 ? `カレンダー実績(連名${e.instructors.length}名)` : 'カレンダー実績',
    });
  });

  for (const e of nonPayable) {
    plan.extra.push({
      master_id: null, date: e.date, start_time: e.start, end_time: e.end,
      instructor_id: null, studio_id: e.studio_id, status: 'scheduled',
      note: `給与対象外: ${e.class_name}`.slice(0, 120),
    });
  }

  expanded.forEach((e, ei) => {
    if (eventTaken.has(ei) || e.cancelled) return;
    plan.extra.push({
      master_id: null, date: e.date, start_time: e.start, end_time: e.end,
      instructor_id: e._instructorId, studio_id: e.studio_id, status: 'scheduled',
      note: `単発: ${e.class_name}`.slice(0, 120),
    });
  });

  return plan;
}
