// src/lib/enrollmentMatch.ts — 体験予約 ↔ 入会会員 の自動突合 (WS AA / 2026-07-27)
//
// trial_records.enrolled_after が全140件0のまま運用されており「体験→入会」が
// 再現できなかった。lstep_id 経由の紐付けは新規客にほぼ効かない(直近30日はCSV30行中25行が未紐付)
// 一方 applicant_name_kana は140/140埋まっているため、カナ突合を主軸にする。
//
// 本番実データでの検証(2026-07-27):
//   - 窓 -7〜+90日で48件ヒット・1体験に複数会員がヒットする曖昧ケースは0件
//   - 同一会員が複数体験にヒットするのは6人 → 最初の体験に寄せる
//   - 月別CVRが既存KPI「体験→月額CVR 51.3%」とほぼ一致することを確認済み

import { normalizeKana } from './linkSuggest';

/** 入会日が体験日のこの日数前まではさかのぼって認める(その場で入会し登録が前後するケース)。 */
export const MATCH_WINDOW_BEFORE_DAYS = 7;
/** 体験からこの日数以内の入会を「その体験由来」とみなす。実データの最長は89日。 */
export const MATCH_WINDOW_AFTER_DAYS = 90;

export type TrialForMatch = {
  id: number;
  applicant_name_kana: string | null;
  /** 'YYYY-MM-DD HH:MM:SS' (JST) */
  reserved_at: string;
  /** 既存の突合根拠。'manual' なら自動突合は触らない */
  matched_by: string | null;
};

export type MemberForMatch = {
  id: number;
  full_name_kana: string;
  /** 'YYYY-MM-DD' 以降の書式。null なら対象外 */
  enrolled_at: string | null;
};

export type EnrollmentMatchResult = {
  matches: { trial_id: number; member_id: number }[];
  /** 1つの体験に複数会員がヒットしたもの。確定させず画面に出して人が判断する */
  ambiguous: { trial_id: number; member_ids: number[] }[];
};

/** 'YYYY-MM-DD...' を1970-01-01からの日数に。解釈できなければ null。 */
function dayNumber(dateStr: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dateStr ?? '').trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function matchEnrollments(
  trials: TrialForMatch[],
  members: MemberForMatch[]
): EnrollmentMatchResult {
  // 正規化カナ → 会員(入会日つき) の索引
  const byKana = new Map<string, { id: number; day: number }[]>();
  for (const m of members) {
    const day = dayNumber(m.enrolled_at);
    if (day === null) continue;
    const kana = normalizeKana(m.full_name_kana ?? '');
    if (!kana) continue;
    const list = byKana.get(kana);
    if (list) list.push({ id: m.id, day });
    else byKana.set(kana, [{ id: m.id, day }]);
  }

  const ambiguous: EnrollmentMatchResult['ambiguous'] = [];
  // 会員ID → 候補の体験。最後に「最初の体験」を選ぶために貯める
  const perMember = new Map<number, { trial_id: number; reserved_at: string }[]>();

  for (const t of trials) {
    if ((t.matched_by ?? '') === 'manual') continue;
    const kana = normalizeKana(t.applicant_name_kana ?? '');
    if (!kana) continue;
    const tDay = dayNumber(t.reserved_at);
    if (tDay === null) continue;

    const hits = (byKana.get(kana) ?? []).filter(
      (m) => m.day >= tDay - MATCH_WINDOW_BEFORE_DAYS && m.day <= tDay + MATCH_WINDOW_AFTER_DAYS
    );
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      ambiguous.push({ trial_id: t.id, member_ids: hits.map((h) => h.id).sort((a, b) => a - b) });
      continue;
    }
    const memberId = hits[0].id;
    const list = perMember.get(memberId);
    if (list) list.push({ trial_id: t.id, reserved_at: t.reserved_at });
    else perMember.set(memberId, [{ trial_id: t.id, reserved_at: t.reserved_at }]);
  }

  // 1入会=1件にする。同じ会員が複数の体験にヒットしたら最初の体験に寄せる
  // (流入経路の起点を正しく取るため)。
  const matches: EnrollmentMatchResult['matches'] = [];
  for (const [memberId, list] of perMember) {
    list.sort((a, b) => (a.reserved_at < b.reserved_at ? -1 : a.reserved_at > b.reserved_at ? 1 : a.trial_id - b.trial_id));
    matches.push({ trial_id: list[0].trial_id, member_id: memberId });
  }
  matches.sort((a, b) => a.trial_id - b.trial_id);

  return { matches, ambiguous };
}
