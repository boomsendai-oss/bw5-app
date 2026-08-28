// アンケート回答の記入名 → boom_members 照合 (WS AO 2026-08-28)
//
// 方針: 誤紐付けは「別の家庭の意見が会員記録に載る」検出困難な事故なので、
//   自動確定(auto)は「本人名がactive会員に一意に完全一致」した時だけ。
//   保護者名(rep_name)一致・複数候補・部分一致・退会者のみ一致・連名は
//   すべて pending(スタッフ承認キュー)に回す。instagramCollect の
//   「原則として自動確定しない」思想と linkSuggest の確信度降格を踏襲。

export interface MatchableMember {
  id: number;
  full_name: string;
  full_name_kana: string;
  rep_name: string | null;
  status: string;
}

export type MatchResult =
  | { status: 'auto'; memberId: number }
  | { status: 'pending'; candidateIds: number[] }
  | { status: 'unmatched' };

/** 記入名の正規化: NFKC(全半角統一)→スペース(半角/全角)全除去→trim。 */
export function normalizeName(raw: string): string {
  return (raw || '').normalize('NFKC').replace(/[\s　]+/g, '');
}

const NAME_SEPARATORS = /[、,・/／]|(?<=[^\x00-\x7F])と(?=[^\x00-\x7F])/;

/** きょうだい連名らしき入力を分割。「山田太郎、山田次郎」「AとB」等。 */
export function splitNames(raw: string): string[] {
  return (raw || '')
    .split(NAME_SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 記入名を会員リストと照合する。members は active に限定せず全件を渡す
 * (退会者のみ一致のケースを unmatched でなく pending として拾うため)。
 */
export function matchMember(rawName: string, members: MatchableMember[]): MatchResult {
  const names = splitNames(rawName);
  if (names.length === 0) return { status: 'unmatched' };
  const isMultiName = names.length > 1;
  const target = normalizeName(names[0]);
  if (!target) return { status: 'unmatched' };

  const exactSelf: MatchableMember[] = [];
  const exactRep: MatchableMember[] = [];
  const partial: MatchableMember[] = [];
  for (const m of members) {
    const name = normalizeName(m.full_name);
    const kana = normalizeName(m.full_name_kana);
    const rep = normalizeName(m.rep_name || '');
    if (target === name || (kana && target === kana)) {
      exactSelf.push(m);
    } else if (rep && target === rep) {
      exactRep.push(m);
    } else if (
      target.length >= 2 &&
      (name.includes(target) || target.includes(name) || (kana && (kana.includes(target) || target.includes(kana))))
    ) {
      partial.push(m);
    }
  }

  const activeExact = exactSelf.filter((m) => m.status === 'active');
  if (!isMultiName && activeExact.length === 1 && exactRep.length === 0) {
    return { status: 'auto', memberId: activeExact[0].id };
  }

  const candidateIds = [...exactSelf, ...exactRep, ...partial].map((m) => m.id);
  if (candidateIds.length === 0) return { status: 'unmatched' };
  return { status: 'pending', candidateIds: Array.from(new Set(candidateIds)) };
}
