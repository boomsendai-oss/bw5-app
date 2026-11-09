// 体験予約をスタッフ用Googleカレンダーへ書く「中身」を作る純粋関数 (2026-11-09 TARO依頼)。
// 「どのクラスにいつ体験さんが入っているか」をカレンダーで一目で見られるようにする。
// 書き込み先は boom.sendai が所有する専用カレンダー(非公開)。生徒が見る正本カレンダーや
// Lstep連携の休講ブロック用カレンダーには一切書かない(trialCalendar.ts 参照)。

import type { TrialGroup } from './trialNotify';

export type LessonSlot = { date: string; start: string; end: string; summary: string; location: string | null };

export type TrialCalendarEvent = {
  key: string;          // 二重防止キー = `${date}|${lessonName}` (buildTrialGroups と同じ単位)
  summary: string;
  description: string;
  date: string;         // 'YYYY-MM-DD'
  start: string;        // 'HH:MM'
  end: string;          // 'HH:MM'
  location: string | null;
  hash: string;         // 中身が変わったか判定する指紋
};

/** 'HH:MM' に分を足す(日付またぎは 23:59 で止める)。 */
export function addMinutes(hhmm: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const total = Math.min(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 文字の重なり具合(共通の文字数)。同じ時刻にレッスンが複数あるときの見分けに使う。 */
function overlap(a: string, b: string): number {
  const norm = (s: string) => s.toUpperCase().replace(/[\s　/／・]/g, '');
  const bs = new Set(norm(b));
  let n = 0;
  for (const ch of new Set(norm(a))) if (bs.has(ch)) n++;
  return n;
}

/**
 * 体験の枠に対応するレッスン(正本カレンダーの予定)を探す。
 * 同じ日・同じ開始時刻のものが1つならそれ、複数なら名前が一番似ているもの。無ければ null。
 */
export function findLessonSlot(date: string, start: string, lessonName: string, slots: LessonSlot[]): LessonSlot | null {
  const same = slots.filter((s) => s.date === date && s.start === start);
  if (same.length === 0) return null;
  if (same.length === 1) return same[0];
  return same.reduce((best, s) => (overlap(lessonName, s.summary) > overlap(lessonName, best.summary) ? s : best));
}

/** 文字列の簡易ハッシュ(FNV-1a)。暗号用途ではなく「変わったか」だけ見る。 */
export function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export const TRIAL_CALENDAR_FOOTER =
  '※BOOMアプリが体験予約(Lステップ)から自動で書き込んでいます(毎日12時・18時ごろ更新)。手で直しても次の更新で元に戻ります。';

/** 紹介者の行(スタッフ用)。referrerLabel は紹介者カナ→照合結果の文言。 */
export function buildReferralBlock(g: TrialGroup, referrerLabel: (kana: string) => string): string {
  const lines = g.visitors
    .filter((v) => v.referrer)
    .map((v) => `・${v.name} ← 紹介者 ${v.referrer}（${referrerLabel(v.referrer as string)}）`);
  if (lines.length === 0) return '';
  return `【ご紹介】入会したら：紹介した人にチケット1回／入会した人は月謝1ヶ月分無料\n${lines.join('\n')}`;
}

/** 体験の枠(TrialGroup)ごとに、カレンダーに置く予定を1件ずつ作る。 */
export function buildTrialCalendarEvents(
  groups: TrialGroup[],
  slots: LessonSlot[],
  referrerLabel: (kana: string) => string = () => '照合なし',
): TrialCalendarEvent[] {
  return groups.map((g) => {
    const trial = g.visitors.filter((v) => !v.isObservation).length;
    const obs = g.visitors.length - trial;
    const counts = [trial ? `体験${trial}名` : '', obs ? `見学${obs}名` : ''].filter(Boolean).join('・');
    const slot = findLessonSlot(g.date, g.time, g.lessonName, slots);
    const summary = `🔰${counts}｜${g.lessonName}`;
    const referral = buildReferralBlock(g, referrerLabel);
    const summary2 = referral ? `${summary}🎁` : summary;
    const description = [g.copyText, referral, TRIAL_CALENDAR_FOOTER].filter(Boolean).join('\n\n');
    const end = slot?.end && slot.end > g.time ? slot.end : addMinutes(g.time, 60);
    const location = slot?.location ?? null;
    const ev = { key: `${g.date}|${g.lessonName}`, summary: summary2, description, date: g.date, start: g.time, end, location };
    return { ...ev, hash: simpleHash(JSON.stringify(ev)) };
  });
}
