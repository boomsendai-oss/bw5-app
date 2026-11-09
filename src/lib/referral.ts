// 紹介者の照合 (2026-11-09 TARO依頼)。
// 体験予約フォームの「ご紹介者のお名前（カタカナ）」を会員名簿(boom_members.full_name_kana)と
// 突き合わせ、紹介特典(紹介した人にチケット1回・入会した人は月謝1ヶ月分無料)の対応漏れを防ぐ。
// 純粋関数のみ(DBに触らない)。

/** 照合用にカナをそろえる: ひらがな→カタカナ、空白・中黒・記号を除去、半角カナは扱わない(フォームが全角カナ限定)。 */
export function normalizeKana(s: string | null | undefined): string {
  let out = '';
  for (const ch of (s ?? '').normalize('NFKC')) {
    const c = ch.charCodeAt(0);
    if (c >= 0x3041 && c <= 0x3096) out += String.fromCharCode(c + 0x60);
    else out += ch;
  }
  return out.replace(/[\s　・･.\-‐－()（）]/g, '').trim();
}

export type ReferrerMatch =
  | { status: 'match'; memberIds: number[] }
  | { status: 'ambiguous'; memberIds: number[] }
  | { status: 'none'; memberIds: [] };

export type MemberKana = { id: number; full_name_kana: string | null };

/** 紹介者カナを会員名簿と照合する。同じカナの会員が複数いれば ambiguous。 */
export function matchReferrer(referrerKana: string | null | undefined, members: MemberKana[]): ReferrerMatch {
  const key = normalizeKana(referrerKana);
  if (!key) return { status: 'none', memberIds: [] };
  const ids = members.filter((m) => normalizeKana(m.full_name_kana) === key).map((m) => m.id);
  if (ids.length === 1) return { status: 'match', memberIds: ids };
  if (ids.length > 1) return { status: 'ambiguous', memberIds: ids };
  return { status: 'none', memberIds: [] };
}

export function referrerMatchLabel(m: ReferrerMatch): string {
  if (m.status === 'match') return '会員名簿と一致';
  if (m.status === 'ambiguous') return '同じ名前の会員が複数・要確認';
  return '会員名簿に見つからず・要確認';
}

/** CSVの1行から紹介者カナを取り出す。項目名に「紹介者」を含む列を全部つなぐ(姓/名に分かれていても拾う)。 */
export function pickReferrerKana(row: Record<string, string>): string | null {
  const v = Object.keys(row)
    .filter((k) => k.includes('紹介者'))
    .map((k) => String(row[k] ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return v || null;
}
