// src/lib/enrollmentMatch.ts — 体験予約 ↔ 入会会員 の自動突合 (WS AA / 2026-07-27)
//
// trial_records.enrolled_after が全140件0のまま運用されており「体験→入会」が
// 再現できなかった。lstep_id 経由の紐付けは新規客にほぼ効かない(直近30日はCSV30行中25行が未紐付)
// 一方 applicant_name_kana は140/140埋まっているため、カナ突合を主軸にする。
//
// 本番実データでの検証(2026-07-27):
//   - 窓 -7〜+90日で48件ヒット・1体験に複数会員がヒットする曖昧ケースは0件
//   - 同一会員が複数体験にヒットするのは6人 → 集計対象(キャンセル/ノーショーでない)の
//     体験を優先し、その中で最初の体験に寄せる。全部キャンセル/ノーショーなら最初の体験。
//     (キャンセル済みの体験に入会を帰属させると、そのままではacquisitionFunnel.tsの
//      分母に数えられず入会がCVRから消えるため。member_id=51で実際に発生を確認)
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
  /** 'キャンセル' なら集計対象外。帰属先の優先度判定に使う */
  status: string | null;
  /** 'noshow' なら集計対象外。同上 */
  attendance_override: string | null;
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

/**
 * 'YYYY-MM-DD...' を1970-01-01からの日数に。解釈できなければ null。
 *
 * `reserved_at`(trial側)・`enrolled_at`(member側)はどちらも同じCSV取込経路で、
 * parseDateTime(csvUtil.ts)がゼロ埋めも書式検証もしないため '2026-7-1' のような
 * 非ゼロ埋め値がそのまま入り得る(src/lib/trialAttendance.ts の同種のハザードを参照)。
 * 正規表現をゼロ埋め厳密 'YYYY-MM-DD' に固定しているのは意図的。緩めないこと。
 * ここでマッチしない行は「日付を信用できない」として突合対象から除外する(fail closed)。
 * 緩めて誤った桁のまま比較すると、窓判定が壊れて誤って一致/不一致になり得るため。
 */
function dayNumber(dateStr: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dateStr ?? '').trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

/**
 * ファネル集計(src/lib/acquisitionFunnel.ts)は「来店した」体験だけを分母に数え、
 * enrolled_after もその来店行でしか読まない。キャンセル/ノーショーの行に入会を
 * 帰属させると、集計上その行が数えられないため入会が月次CVR・流入経路別の
 * どちらからも消えてしまう(本番: member_id=51で確認済み)。
 * ここでの判定は todayJstStr を使わない(未来日の体験はそもそも突合窓を満たせないため
 * resolveAttendance の「当日中は予約済扱い」ロジックは不要)。
 */
const isCountable = (t: TrialForMatch) =>
  (t.status ?? '').trim() !== 'キャンセル' && (t.attendance_override ?? '') !== 'noshow';

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
  // 会員ID → 候補の体験。最後に「帰属させる1件」を選ぶために貯める。
  // reserved_at の時刻部分は dayNumber() で検証していない(日付部分しか見ない)ため、
  // ソートの根拠には検証済みの tDay(日数)だけを使う。時刻文字列は比較に使わない。
  const perMember = new Map<number, { trial_id: number; tDay: number; countable: boolean }[]>();

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
    const entry = { trial_id: t.id, tDay, countable: isCountable(t) };
    const list = perMember.get(memberId);
    if (list) list.push(entry);
    else perMember.set(memberId, [entry]);
  }

  // 1入会=1件にする。同じ会員が複数の体験にヒットしたら、まず集計対象になる
  // (キャンセル/ノーショーでない)体験を優先し、その中で最初の体験に寄せる
  // (流入経路の起点を正しく取るため)。全候補がキャンセル/ノーショーしかない
  // 場合でも、突合そのものは記録に残す(監査できるように)ため最初の体験を選ぶ。
  // 同日の複数体験は trial_id 昇順で確定させる(時刻文字列は書式が不揃いなため
  // 比較に使わない=決定的なタイブレーク)。
  const matches: EnrollmentMatchResult['matches'] = [];
  for (const [memberId, list] of perMember) {
    list.sort((a, b) => {
      const countableRank = (v: boolean) => (v ? 0 : 1);
      if (countableRank(a.countable) !== countableRank(b.countable)) {
        return countableRank(a.countable) - countableRank(b.countable);
      }
      return a.tDay !== b.tDay ? a.tDay - b.tDay : a.trial_id - b.trial_id;
    });
    matches.push({ trial_id: list[0].trial_id, member_id: memberId });
  }
  matches.sort((a, b) => a.trial_id - b.trial_id);
  // ambiguous も matches と同様に trial_id 昇順で確定させる(呼び出し元SQLの並び順に依存しないため)。
  ambiguous.sort((a, b) => a.trial_id - b.trial_id);

  return { matches, ambiguous };
}
