// 新規入会者を Lstep 友だちと自動紐付けするための候補抽出ロジック

import { getAll } from './db';

export type LstepFriend = {
  lstep_id: string;
  display_name: string | null;
  system_display_name: string | null;
  line_register_name: string | null;
  real_name: string | null;
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

export type LinkCandidate = {
  lstep_id: string;
  system_display_name: string;
  line_register_name: string;
  score: number;
  confidence: '高' | '中';
  reasons: string[];
  relation_suggestion: '本人' | '保護者' | '講師';
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
  return toKatakana(s).replace(/[\s　・,、.。\-ー－/]/g, '');
}

// "アベ セイナ" -> ["アベ", "セイナ"]
function splitNameKana(fullKana: string): { sei: string; mei: string } {
  const trimmed = (fullKana ?? '').trim().replace(/[　]+/g, ' ');
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { sei: normalizeKana(parts[0]), mei: normalizeKana(parts.slice(1).join('')) };
  // 区切りなし: 先頭2文字を姓推定 (粗いがフォールバック)
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

export function scoreCandidate(
  member: Member,
  friend: LstepFriend,
  siblingLinks: ExistingLink[]
): { score: number; reasons: string[]; relation: '本人' | '保護者' | '講師' } | null {
  const memberKana = splitNameKana(member.full_name_kana);
  const memberRaw = splitNameRaw(member.full_name);

  // Lstep 側から比較対象になりそうな文字列を全部かき集める
  const sys = friend.system_display_name ?? '';
  const line = friend.line_register_name ?? '';
  const real = friend.real_name ?? '';

  const sysKana = normalizeKana(sys);
  const lineKana = normalizeKana(line);
  const realKana = normalizeKana(real);

  let score = 0;
  const reasons: string[] = [];

  // 姓カナ一致 (Lstep側の任意フィールドに会員姓カナが含まれる)
  if (memberKana.sei && (sysKana.includes(memberKana.sei) || lineKana.includes(memberKana.sei) || realKana.includes(memberKana.sei))) {
    score += 50;
    reasons.push('姓カナ一致');
  }
  // 名カナ一致
  if (memberKana.mei && memberKana.mei.length >= 2 && (sysKana.includes(memberKana.mei) || lineKana.includes(memberKana.mei) || realKana.includes(memberKana.mei))) {
    score += 30;
    reasons.push('名カナ一致');
  }

  // 漢字 (本名) 一致
  if (memberRaw.sei && real && real.includes(memberRaw.sei)) {
    score += 20;
    reasons.push('本名(漢字)姓一致');
  }
  if (memberRaw.mei && real && real.includes(memberRaw.mei)) {
    score += 10;
    reasons.push('本名(漢字)名一致');
  }

  // 兄弟紐付け済 (同じ lstep_id に同姓カナの会員が紐付け済)
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

  // 役割推測
  // system_display_name に "(1)" "(子" "子:" "母" "父" 等があれば保護者
  let relation: '本人' | '保護者' | '講師' = '本人';
  const sysJoined = `${sys} ${line} ${real}`;
  if (/子[：:]|（子|\(子|母|父|保護者|ママ|パパ/.test(sysJoined) || siblingMatch) {
    relation = '保護者';
  }
  if (/講師|先生|インストラクター/.test(sysJoined)) {
    relation = '講師';
  }

  return { score, reasons, relation };
}

export async function buildLinkSuggestions(
  targetMembers: Member[]
): Promise<LinkSuggestion[]> {
  if (targetMembers.length === 0) return [];

  const friends = (await getAll(
    `SELECT lstep_id, display_name, system_display_name, line_register_name, real_name
     FROM lstep_friends WHERE COALESCE(blocked,0) = 0`
  )) as LstepFriend[];

  // 既存紐付け (兄弟判定用) — member 名カナも JOIN
  const existingLinks = (await getAll(
    `SELECT ml.member_id, ml.lstep_id, ml.relation, bm.full_name_kana AS member_full_name_kana
     FROM member_lstep_links ml
     JOIN boom_members bm ON bm.id = ml.member_id`
  )) as ExistingLink[];

  const suggestions: LinkSuggestion[] = [];
  for (const m of targetMembers) {
    const cands: LinkCandidate[] = [];
    for (const f of friends) {
      const s = scoreCandidate(m, f, existingLinks);
      if (!s) continue;
      cands.push({
        lstep_id: f.lstep_id,
        system_display_name: f.system_display_name ?? '',
        line_register_name: f.line_register_name ?? '',
        score: s.score,
        confidence: s.score >= 100 ? '高' : '中',
        reasons: s.reasons,
        relation_suggestion: s.relation,
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
