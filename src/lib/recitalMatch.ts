// BW6 発表会（段階1）の会員照合と、特別な料金の事前登録の照らし合わせ。生年月日の形をそろえる。
// 純関数。DB にさわらない。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 決まりの正本は設計書 05 5-8・03 3-7・D4 2-10・直し8。
import { normalizeKana } from '@/lib/csvUtil';
import type { FeeClass } from './recital';

/**
 * 照合に使う会員の形。`status` は 'active'／'withdrew'（退会。boom_members.status のまま）／
 * 'leave'（休会。Task 6 の loadMembersLite が boom_members.member_type = '休会' のとき入れる）
 */
export type MemberLite = { id: number; fullName: string | null; fullNameKana: string | null; birthday: string | null; status: string | null };

/** 照合の結果。match_status の none・manual はスタッフが決める値なので、ここでは返さない */
export type MemberMatch = { status: 'auto' | 'pending' | 'unmatched'; memberId: number | null; candidateIds: number[]; warn: 'leave' | 'withdrawn' | null };

type PersonForMatch = { lastKana: string; firstKana: string; lastName: string; firstName: string; birthday: string | null };

/** 後ろに付いた時刻（` 00:00:00`・`T…`）は読まずに日付だけ見る */
const TIME_TAIL = '(?:[ T].*)?';
const BIRTHDAY_FORMS: readonly RegExp[] = [
  new RegExp(`^(\\d{4})([-/])(\\d{1,2})\\2(\\d{1,2})${TIME_TAIL}$`),
  new RegExp(`^(\\d{4})()(\\d{2})(\\d{2})${TIME_TAIL}$`),
  new RegExp(`^(\\d{4})(年)(\\d{1,2})月(\\d{1,2})日${TIME_TAIL}$`),
];

/** 生年月日を 'YYYY-MM-DD' にそろえる。実在しない日・読めない形（日の順が分からない MM/DD/YYYY など）は null */
export function normalizeBirthday(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.normalize('NFKC').trim();
  if (!t) return null;
  for (const re of BIRTHDAY_FORMS) {
    const g = re.exec(t);
    if (!g) continue;
    const y = Number(g[1]);
    const mo = Number(g[3]);
    const d = Number(g[4]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

/** カナをそろえる（NFKC で半角カナ・全角英数をそろえ、normalizeKana でひらがな→カタカナ・空白/中点/長音を取る・ヅ→ズ・ヂ→ジ） */
function kanaKey(s: string | null | undefined): string {
  return normalizeKana((s ?? '').normalize('NFKC'));
}

/** 漢字の名前をそろえる（NFKC・空白を取る） */
function nameKey(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKC').replace(/\s/g, '');
}

/** カナが合う人・カナと生年月日の両方が合う人・（カナがだれとも合わないとき）漢字の名前が合う人。どれも id の小さい順 */
function collectHits(p: PersonForMatch, members: MemberLite[]): { both: MemberLite[]; kana: MemberLite[]; kanji: MemberLite[] } {
  const sorted = [...members].sort((a, b) => a.id - b.id);
  const pk = kanaKey(p.lastKana + p.firstKana);
  const kana = pk ? sorted.filter((m) => kanaKey(m.fullNameKana) === pk) : [];
  const pb = normalizeBirthday(p.birthday);
  const both = pb ? kana.filter((m) => normalizeBirthday(m.birthday) === pb) : [];
  let kanji: MemberLite[] = [];
  if (kana.length === 0) {
    const pn = nameKey(p.lastName + p.firstName);
    if (pn) kanji = sorted.filter((m) => nameKey(m.fullName) === pn);
  }
  return { both, kana, kanji };
}

const ids = (ms: MemberLite[]): number[] => ms.map((m) => m.id);

/** 退会（withdrew）・休会（leave）の会員なら印。照合の warn と、スタッフの「見てほしいこと」2番が使う */
export function memberWarn(m: MemberLite): 'leave' | 'withdrawn' | null {
  return m.status === 'withdrew' ? 'withdrawn' : m.status === 'leave' ? 'leave' : null;
}

/** 申込の人を会員に照らし合わせる（05 5-8）。退会・休会の人と自動で合ったときは warn を付ける（止めない） */
export function matchMember(p: PersonForMatch, members: MemberLite[]): MemberMatch {
  const { both, kana, kanji } = collectHits(p, members);
  if (both.length === 1) {
    const hit = both[0];
    return { status: 'auto', memberId: hit.id, candidateIds: [hit.id], warn: memberWarn(hit) };
  }
  if (both.length >= 2) return { status: 'pending', memberId: null, candidateIds: ids(both), warn: null };
  if (kana.length > 0) return { status: 'pending', memberId: null, candidateIds: ids(kana), warn: null };
  if (kanji.length > 0) return { status: 'pending', memberId: null, candidateIds: ids(kanji), warn: null };
  return { status: 'unmatched', memberId: null, candidateIds: [], warn: null };
}

/**
 * 特別な料金の事前登録に照らし合わせる（D4 2-10・直し8）。事前登録の会員だけを相手にする。
 * 両方合う登録の会員がちょうど1人 → その種類／両方合うのが2人以上・カナだけ合う・漢字だけ合う → suspect（印は入れない）／ほか → null。
 * 登録の無い会員とだけ合っても null（勝手に安くしない）
 */
export function matchFeePreset(
  p: PersonForMatch,
  presets: { memberId: number; feeClass: Exclude<FeeClass, null> }[],
  members: MemberLite[],
): { feeClass: Exclude<FeeClass, null>; memberId: number } | { suspect: true } | null {
  const feeByMember = new Map(presets.map((x) => [x.memberId, x.feeClass]));
  const { both, kana, kanji } = collectHits(p, members.filter((m) => feeByMember.has(m.id)));
  if (both.length === 1) return { feeClass: feeByMember.get(both[0].id)!, memberId: both[0].id };
  if (both.length >= 2 || kana.length > 0 || kanji.length > 0) return { suspect: true };
  return null;
}
