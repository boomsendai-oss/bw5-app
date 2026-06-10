// 会員(HACOMONO) ↔ LINE(Lstep友だちID) 自動紐付けの候補抽出ロジック
//
// 主軸: 体験予約データ (trial_records) の「友だちID + 子のフルネーム(カナ)」を使う。
//   体験を受けないと入会できない運用のため、全会員が必ず体験を通過している。
//   体験予約のカナ名と会員のカナ名を突合すれば、友だちID(=LINEアカウント)を高精度で特定できる。
// フォールバック: Lstep友だちの表示名(ニックネーム)とのカナ突合 (精度は低い)。
//
// LINE種別判定 (そのLINEが本人のものか保護者のものか):
//   - 保護者LINE: 続柄=母/父等 OR 年齢≤12 OR 代表者(別人)あり OR 1つのIDに複数会員(兄弟)
//   - 本人LINE  : 年齢≥18 AND 代表者なし
//   - 要確認    : 13〜17歳など断定できないグレーゾーン

import { getAll } from './db';

export type LstepFriend = {
  lstep_id: string;
  display_name: string | null;
  system_display_name: string | null;
  line_register_name: string | null;
  real_name: string | null;
  customer_kana: string | null;
};

export type Member = {
  id: number;
  hacomono_member_id: string;
  full_name: string;
  full_name_kana: string;
};

export type ExistingLink = {
  member_id: number;
  lstep_id: string;
  relation: string;
  member_full_name_kana: string;
};

export type LineType = '本人LINE' | '保護者LINE' | '要確認';

export type LinkCandidate = {
  lstep_id: string;
  system_display_name: string;
  line_register_name: string;
  customer_kana: string; // 体験予約CSV由来の持ち主カナ(親名プリセット用)
  score: number;
  confidence: '高' | '中';
  reasons: string[];
  relation_suggestion: '本人' | '保護者' | '講師';
  line_type: LineType;
  source: '体験予約' | 'Lstep表示名';
};

export type LinkSuggestion = {
  member_id: number;
  hacomono_member_id: string;
  full_name: string;
  full_name_kana: string;
  candidates: LinkCandidate[];
};

export function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export function normalizeKana(s: string): string {
  if (!s) return '';
  return toKatakana(s)
    .replace(/[\s　・,、.。\-ー－/]/g, '')
    // 四つ仮名の表記揺れを同一視 (ミヅキ=ミズキ 等)。csvUtil.normalizeKana と合わせる
    .replace(/ヅ/g, 'ズ')
    .replace(/ヂ/g, 'ジ');
}

// "アベ セイナ" -> ["アベ", "セイナ"]
function splitNameKana(fullKana: string): { sei: string; mei: string } {
  const trimmed = (fullKana ?? '').trim().replace(/[　]+/g, ' ');
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { sei: normalizeKana(parts[0]), mei: normalizeKana(parts.slice(1).join('')) };
  const n = normalizeKana(trimmed);
  if (n.length <= 2) return { sei: n, mei: '' };
  return { sei: n.slice(0, 2), mei: n.slice(2) };
}

function splitNameRaw(full: string): { sei: string; mei: string } {
  const trimmed = (full ?? '').trim().replace(/[　]+/g, ' ');
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { sei: parts[0], mei: parts.slice(1).join('') };
  return { sei: trimmed, mei: '' };
}

// 'YYYY-MM-DD' から現在年齢を算出
export function ageFromBirthday(birthday: string | null | undefined, today: Date = new Date()): number | null {
  if (!birthday) return null;
  const m = String(birthday).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  let age = today.getFullYear() - y;
  const md = today.getMonth() + 1 - mo || today.getDate() - d;
  if (md < 0) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

// LINE種別と推測役割を判定
export function classifyLineType(args: {
  age: number | null;
  guardianRelation: string | null;
  hasRep: boolean;
  siblingCount: number;
}): { line_type: LineType; relation: '本人' | '保護者'; reason: string } {
  const { age, guardianRelation, hasRep, siblingCount } = args;
  const guardianSig = !!guardianRelation && /母|父|祖|親|保護/.test(guardianRelation);

  if (guardianSig) return { line_type: '保護者LINE', relation: '保護者', reason: `続柄=${guardianRelation}` };
  if (siblingCount >= 2) return { line_type: '保護者LINE', relation: '保護者', reason: `同一LINEに複数会員(${siblingCount}人)` };
  if (hasRep) return { line_type: '保護者LINE', relation: '保護者', reason: '代表者(別人)あり' };
  if (age != null && age <= 12) return { line_type: '保護者LINE', relation: '保護者', reason: `年齢${age}歳(≤12)` };
  if (age != null && age >= 18) return { line_type: '本人LINE', relation: '本人', reason: `年齢${age}歳(≥18)` };
  // グレーゾーン(13〜17歳 / 年齢不明)
  const rel = age != null && age <= 15 ? '保護者' : '本人';
  return { line_type: '要確認', relation: rel, reason: age != null ? `年齢${age}歳(要確認)` : '年齢不明(要確認)' };
}

// ===== フォールバック: Lstep表示名とのカナ突合 (旧ロジック) =====
export function scoreCandidate(
  member: Member,
  friend: LstepFriend,
  siblingLinks: ExistingLink[]
): { score: number; reasons: string[]; relation: '本人' | '保護者' | '講師' } | null {
  const memberKana = splitNameKana(member.full_name_kana);
  const memberRaw = splitNameRaw(member.full_name);

  const sys = friend.system_display_name ?? '';
  const line = friend.line_register_name ?? '';
  const real = friend.real_name ?? '';
  const disp = friend.display_name ?? ''; // 表示名にだけカナがあるケース(例:イマムラミズキ)

  const sysKana = normalizeKana(sys);
  const lineKana = normalizeKana(line);
  const realKana = normalizeKana(real);
  const dispKana = normalizeKana(disp);

  let score = 0;
  const reasons: string[] = [];

  if (memberKana.sei && (sysKana.includes(memberKana.sei) || lineKana.includes(memberKana.sei) || realKana.includes(memberKana.sei) || dispKana.includes(memberKana.sei))) {
    score += 50;
    reasons.push('姓カナ一致');
  }
  if (memberKana.mei && memberKana.mei.length >= 2 && (sysKana.includes(memberKana.mei) || lineKana.includes(memberKana.mei) || realKana.includes(memberKana.mei) || dispKana.includes(memberKana.mei))) {
    score += 30;
    reasons.push('名カナ一致');
  }
  if (memberRaw.sei && real && real.includes(memberRaw.sei)) {
    score += 20;
    reasons.push('本名(漢字)姓一致');
  }
  if (memberRaw.mei && real && real.includes(memberRaw.mei)) {
    score += 10;
    reasons.push('本名(漢字)名一致');
  }

  const siblingMatch = siblingLinks.find(
    (l) =>
      l.lstep_id === friend.lstep_id &&
      l.member_id !== member.id &&
      splitNameKana(l.member_full_name_kana).sei === memberKana.sei &&
      memberKana.sei
  );
  if (siblingMatch) {
    score += 50;
    reasons.push(`兄弟紐付け済(${siblingMatch.relation})`);
  }

  if (score < 60) return null;

  let relation: '本人' | '保護者' | '講師' = '本人';
  const sysJoined = `${sys} ${line} ${real} ${disp}`;
  if (/子[：:]|（子|\(子|母|父|保護者|ママ|パパ/.test(sysJoined) || siblingMatch) {
    relation = '保護者';
  }
  if (/講師|先生|インストラクター/.test(sysJoined)) {
    relation = '講師';
  }

  return { score, reasons, relation };
}

type MemberExtra = {
  id: number;
  birthday: string | null;
  guardian_relation: string | null;
  rep_name: string | null;
};

type TrialRow = {
  lstep_id: string;
  applicant_name: string | null;
  applicant_name_kana: string | null;
  applicant_age: number | null;
};

export async function buildLinkSuggestions(
  targetMembers: Member[]
): Promise<LinkSuggestion[]> {
  if (targetMembers.length === 0) return [];

  // 対象会員の追加属性 (年齢/続柄/代表氏名)
  const ids = targetMembers.map((m) => m.id);
  const idPlaceholders = ids.map(() => '?').join(',');
  const extras = (await getAll(
    `SELECT id, birthday, guardian_relation, rep_name FROM boom_members WHERE id IN (${idPlaceholders})`,
    ids
  )) as MemberExtra[];
  const extraById = new Map<number, MemberExtra>();
  for (const e of extras) extraById.set(e.id, e);

  // 体験予約 (友だちID + 子のカナ名)
  const trials = (await getAll(
    `SELECT lstep_id, applicant_name, applicant_name_kana, applicant_age
       FROM trial_records
      WHERE lstep_id IS NOT NULL AND lstep_id != ''
        AND ((applicant_name_kana IS NOT NULL AND applicant_name_kana != '')
          OR (applicant_name IS NOT NULL AND applicant_name != ''))`
  )) as TrialRow[];

  // kana(正規化) -> lstep_id集合 / kanji名 -> lstep_id集合
  const lstepByKana = new Map<string, Set<string>>();
  const lstepByName = new Map<string, Set<string>>();
  // lstep_id -> 異なる子カナ名集合 (兄弟カウント) / 代表年齢
  const childKanaByLstep = new Map<string, Set<string>>();
  const ageByLstepKana = new Map<string, number>();
  // 表示用: lstep_id+kana -> 申込者名
  const nameByLstepKana = new Map<string, string>();

  for (const t of trials) {
    const lid = t.lstep_id;
    const kana = normalizeKana(t.applicant_name_kana ?? '');
    const name = normalizeKana(t.applicant_name ?? '');
    if (kana) {
      if (!lstepByKana.has(kana)) lstepByKana.set(kana, new Set());
      lstepByKana.get(kana)!.add(lid);
      if (!childKanaByLstep.has(lid)) childKanaByLstep.set(lid, new Set());
      childKanaByLstep.get(lid)!.add(kana);
      if (t.applicant_age != null) ageByLstepKana.set(`${lid}|${kana}`, t.applicant_age);
      if (t.applicant_name) nameByLstepKana.set(`${lid}|${kana}`, t.applicant_name);
    }
    if (name) {
      if (!lstepByName.has(name)) lstepByName.set(name, new Set());
      lstepByName.get(name)!.add(lid);
    }
  }

  // Lstep友だち (フォールバック)
  const friends = (await getAll(
    `SELECT lstep_id, display_name, system_display_name, line_register_name, real_name, customer_kana
     FROM lstep_friends WHERE COALESCE(blocked,0) = 0`
  )) as LstepFriend[];

  // 既存紐付け (兄弟判定・重複除外用)
  const existingLinks = (await getAll(
    `SELECT ml.member_id, ml.lstep_id, ml.relation, bm.full_name_kana AS member_full_name_kana
     FROM member_lstep_links ml
     JOIN boom_members bm ON bm.id = ml.member_id`
  )) as ExistingLink[];

  const suggestions: LinkSuggestion[] = [];

  for (const m of targetMembers) {
    const extra = extraById.get(m.id);
    const memberKana = normalizeKana(m.full_name_kana);
    const memberNameNorm = normalizeKana(m.full_name);
    const seen = new Set<string>(); // lstep_id 重複除外
    const cands: LinkCandidate[] = [];

    // --- 主軸: 体験予約カナ名で突合 ---
    const matchedLstep = new Set<string>();
    if (memberKana) for (const lid of lstepByKana.get(memberKana) ?? []) matchedLstep.add(lid);
    // カナが無い/不一致のときは漢字名でも試す
    if (matchedLstep.size === 0 && memberNameNorm) {
      for (const lid of lstepByName.get(memberNameNorm) ?? []) matchedLstep.add(lid);
    }

    for (const lid of matchedLstep) {
      if (seen.has(lid)) continue;
      seen.add(lid);
      const siblingCount = childKanaByLstep.get(lid)?.size ?? 1;
      const age = ageFromBirthday(extra?.birthday) ?? ageByLstepKana.get(`${lid}|${memberKana}`) ?? null;
      const cls = classifyLineType({
        age,
        guardianRelation: extra?.guardian_relation ?? null,
        hasRep: !!extra?.rep_name,
        siblingCount,
      });
      const friend = friends.find((f) => f.lstep_id === lid);
      const reasons = ['体験予約カナ名一致', `LINE種別: ${cls.line_type}(${cls.reason})`];
      cands.push({
        lstep_id: lid,
        system_display_name: friend?.system_display_name ?? friend?.display_name ?? '',
        line_register_name: friend?.line_register_name ?? '',
        customer_kana: friend?.customer_kana ?? '',
        score: 120, // 体験予約一致は最高信頼
        confidence: cls.line_type === '要確認' ? '中' : '高',
        reasons,
        relation_suggestion: cls.relation,
        line_type: cls.line_type,
        source: '体験予約',
      });
    }

    // --- フォールバック: Lstep表示名カナ突合 ---
    for (const f of friends) {
      if (seen.has(f.lstep_id)) continue;
      const s = scoreCandidate(m, f, existingLinks);
      if (!s) continue;
      seen.add(f.lstep_id);
      const siblingCount = childKanaByLstep.get(f.lstep_id)?.size ?? 1;
      const age = ageFromBirthday(extra?.birthday);
      const cls = classifyLineType({
        age,
        guardianRelation: extra?.guardian_relation ?? null,
        hasRep: !!extra?.rep_name,
        siblingCount,
      });
      // 講師は種別判定より優先
      const relation = s.relation === '講師' ? '講師' : cls.relation;
      cands.push({
        lstep_id: f.lstep_id,
        system_display_name: f.system_display_name ?? '',
        line_register_name: f.line_register_name ?? '',
        customer_kana: f.customer_kana ?? '',
        score: s.score,
        confidence: s.score >= 100 ? '高' : '中',
        reasons: [...s.reasons, `LINE種別: ${cls.line_type}(${cls.reason})`],
        relation_suggestion: relation,
        line_type: s.relation === '講師' ? '本人LINE' : cls.line_type,
        source: 'Lstep表示名',
      });
    }

    cands.sort((a, b) => b.score - a.score);
    suggestions.push({
      member_id: m.id,
      hacomono_member_id: m.hacomono_member_id,
      full_name: m.full_name,
      full_name_kana: m.full_name_kana,
      candidates: cands.slice(0, 5),
    });
  }
  return suggestions;
}
