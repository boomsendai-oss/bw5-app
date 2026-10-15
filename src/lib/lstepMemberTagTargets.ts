// src/lib/lstepMemberTagTargets.ts — 入会済みの人のLINEアカウントに付けるべき入会タグを決める (2026-10-15)
//
// 体験後フォローのシナリオ(Lステップ id 1104294)は「入会タグ(4-A本人/4-B保護者)が付いている人」を
// 除外して送る。ところがタグを自動で付ける仕組みが無く、入会した人にもクーポン案内が届いていた。
// ここでは「どのLINEアカウントに、本人/保護者のどちらのタグを付けるか」だけを決める。
// 実際に付けるのは boom-events-hub の GitHub Actions (scripts/lstep-member-tag)。
//
// TAROの決定(2026-10-15):
//   - 月額会員だけでなくチケット会員も「入会済み」に含める
//   - 体験予約との自動照合でひもづいた人は、氏名とカナが両方とも完全一致するときだけ自動で付ける
//   - 保護者のアカウントには本人用(4-A)を付けない(保護者用4-Bで除外される)

import { normalizeKana } from './linkSuggest';

export const ELIGIBLE_MEMBER_TYPES = ['regular', 'college', 'ticket'] as const;
/** これ未満の年齢の会員は、体験予約したLINEアカウントを保護者のものとみなす */
export const GUARDIAN_AGE_BELOW = 18;

export type TagKind = 'member' | 'guardian';

export type MemberRow = {
  id: number;
  hacomono_member_id: string;
  full_name: string;
  full_name_kana: string;
  member_type: string | null;
  birthday: string | null;
};
export type LinkRow = { member_id: number; lstep_id: string; relation: string; confidence: string | null };
export type TrialRow = {
  lstep_id: string | null;
  enrolled_member_id: number | null;
  applicant_name: string | null;
  applicant_name_kana: string | null;
  applicant_age: number | null;
};

export type Target = { lstepId: string; kind: TagKind; memberRefs: string[]; source: 'link' | 'trial' };
export type Review = { lstepId: string; memberRef: string; reason: string };

const normalizeName = (s: string | null) => (s ?? '').replace(/[\s　]/g, '');

/** 'YYYY-MM-DD' の誕生日から today 時点の満年齢。読めなければ null */
export function ageOn(birthday: string | null, today: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday ?? '');
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!b || !t) return null;
  let age = Number(t[1]) - Number(b[1]);
  if (t[2] + t[3] < b[2] + b[3]) age -= 1;
  return age;
}

export function decideTargets(
  { members, links, trials, today }: { members: MemberRow[]; links: LinkRow[]; trials: TrialRow[]; today: string },
): { targets: Target[]; review: Review[] } {
  const eligible = new Map(
    members
      .filter((m) => (ELIGIBLE_MEMBER_TYPES as readonly string[]).includes(m.member_type ?? ''))
      .map((m) => [m.id, m]),
  );
  const byAccount = new Map<string, Target>();
  const review: Review[] = [];

  const add = (lstepId: string, kind: TagKind, ref: string, source: Target['source']) => {
    const cur = byAccount.get(lstepId);
    if (!cur) { byAccount.set(lstepId, { lstepId, kind, memberRefs: [ref], source }); return; }
    // 1つのアカウントが本人でもあり保護者でもある(親子で会員)なら本人用を付ける
    if (kind === 'member') cur.kind = 'member';
    if (!cur.memberRefs.includes(ref)) cur.memberRefs.push(ref);
  };

  // 1) 人が確認済みのひもづけ
  const linked = new Set<string>();
  for (const l of links) {
    const m = eligible.get(l.member_id);
    if (!m || !l.lstep_id) continue;
    if (l.relation !== '本人' && l.relation !== '保護者') continue; // 講師などは対象外
    if (l.confidence !== '確実') {
      review.push({ lstepId: l.lstep_id, memberRef: m.hacomono_member_id, reason: 'ひもづけが「推定」のまま' });
      continue;
    }
    add(l.lstep_id, l.relation === '本人' ? 'member' : 'guardian', m.hacomono_member_id, 'link');
    linked.add(`${l.member_id}|${l.lstep_id}`);
  }

  // 2) 体験予約との自動照合。氏名とカナの両方が一致するときだけ
  for (const t of trials) {
    const m = t.enrolled_member_id == null ? undefined : eligible.get(t.enrolled_member_id);
    if (!m || !t.lstep_id) continue;
    if (linked.has(`${m.id}|${t.lstep_id}`)) continue;
    const sameName = normalizeName(t.applicant_name) !== '' && normalizeName(t.applicant_name) === normalizeName(m.full_name);
    const sameKana = normalizeKana(t.applicant_name_kana ?? '') !== ''
      && normalizeKana(t.applicant_name_kana ?? '') === normalizeKana(m.full_name_kana);
    if (!sameName || !sameKana) {
      review.push({ lstepId: t.lstep_id, memberRef: m.hacomono_member_id, reason: '体験予約と会員の氏名かカナが一致しない' });
      continue;
    }
    const age = ageOn(m.birthday, today) ?? t.applicant_age;
    if (age == null) {
      review.push({ lstepId: t.lstep_id, memberRef: m.hacomono_member_id, reason: '年齢が分からず本人か保護者か決められない' });
      continue;
    }
    add(t.lstep_id, age < GUARDIAN_AGE_BELOW ? 'guardian' : 'member', m.hacomono_member_id, 'trial');
  }

  // 自動で付けるアカウントは要確認から外す(別の会員経由で確定している)
  const targets = [...byAccount.values()].sort((a, b) => a.lstepId.localeCompare(b.lstepId));
  const decided = new Set(targets.map((t) => t.lstepId));
  return { targets, review: review.filter((r) => !decided.has(r.lstepId)) };
}
