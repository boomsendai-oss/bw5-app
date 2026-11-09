// 紹介者の照合 (2026-11-09 TARO依頼)。
// 体験予約フォームの「ご紹介者のお名前（カタカナ）」を会員名簿(boom_members.full_name_kana)と
// 突き合わせ、紹介特典(紹介した人にチケット1回・入会した人は月謝1ヶ月分無料)の対応漏れを防ぐ。
// 純粋関数のみ(DBに触らない)。

/**
 * 照合用にカナをそろえる(紹介者欄の表記ゆれを吸収・2026-11-09 TARO依頼)。
 * - 全角/半角(NFKC)・ひらがな→カタカナ
 * - 空白(全角/半角)・中黒・ピリオド・ハイフン類・括弧を除去
 * - ヂ→ジ / ヅ→ズ / ヴ→ブ / ヰ→イ / ヱ→エ (入力ゆれ)
 * - 末尾の敬称(サン/サマ/クン/チャン/様/さん)を除去(残りが3文字以上のときだけ)
 */
export function normalizeKana(s: string | null | undefined): string {
  let out = '';
  for (const ch of (s ?? '').normalize('NFKC')) {
    const c = ch.charCodeAt(0);
    if (c >= 0x3041 && c <= 0x3096) out += String.fromCharCode(c + 0x60);
    else out += ch;
  }
  out = out.replace(/[\s　・･.\-‐－―()（）]/g, '');
  out = out.replace(/ヂ/g, 'ジ').replace(/ヅ/g, 'ズ').replace(/ヴ/g, 'ブ').replace(/ヰ/g, 'イ').replace(/ヱ/g, 'エ');
  const m = /^(.*?)(サン|サマ|クン|チャン|様)$/.exec(out);
  if (m && m[1].length >= 3) out = m[1];
  return out.trim();
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
