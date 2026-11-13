// 入会特典Tシャツ(2026-11-13)の判定・集計(純粋関数)。DB層は giftTshirtDb.ts。
// 設計: boom-events-hub docs/superpowers/specs/2026-11-13-gift-tshirt-automation-design.md §2・§6・§7-3
// ⚠️ 名前はここに来ない(内部IDだけ)。お客さんへの送信・Amazonでの購入はこのファイルでも呼び出し元でもしない。

/** この日以降の入会だけ台帳に入れる(秘書の決定 11/13: それより前は手渡し済みか記録で分からない) */
export const GIFT_START_DATE = '2026-11-01';

/** ボディの品番(United Athle 5.6oz)。大人=5001-01・キッズ=5001-02 */
export const ITEM_ADULT = 'United Athle 5001-01';
export const ITEM_KIDS = 'United Athle 5001-02';

/** 全9色(旧入稿データ2ページ目。HPは11/10に「全9色」へ修正済み) */
export const COLORS = ['ホワイト', 'ネイビー', 'ブラック', 'レッド', 'ピンク', 'メロン', 'バナナ', 'ミックスグレー', 'ライトブルー'] as const;
export type GiftColor = (typeof COLORS)[number];

/** キッズ110〜160(110・120も用意=秘書の決定 11/13)・大人S〜XXL */
export const KIDS_SIZES = ['110', '120', '130', '140', '150', '160'] as const;
export const ADULT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
export const SIZES = [...KIDS_SIZES, ...ADULT_SIZES] as const;
export type GiftSize = (typeof SIZES)[number];

/**
 * 入会時の請求が「特典を使って月謝プランで入会」か。eligible.cjs と同じ条件:
 * 入会金x1 + クーポン割引(入会金) + クーポン割引(…月会費…) があり、チケット会員でない。
 */
export function isGiftEligibleProduct(productName: string | null | undefined): boolean {
  const s = productName ?? '';
  return (
    s.includes('入会金x1') &&
    s.includes('クーポン割引 (入会金)') &&
    /クーポン割引 \([^)]*月会費/.test(s) &&
    !s.includes('チケット会員')
  );
}

/** 取り消された請求(キャンセル・返金)は特典の対象にしない */
export function isCancelledBilling(status: string | null | undefined): boolean {
  const s = status ?? '';
  return s.includes('キャンセル') || s.includes('返金');
}

export type BillingCandidate = {
  billing_record_id: number;
  billing_date: string;
  boom_member_id: number | null;
  product_name: string | null;
  status: string | null;
  line_linked: boolean;
};

export type NewClaim = {
  boom_member_id: number;
  billing_record_id: number;
  enrolled_on: string;
  status: 'invite_pending' | 'no_line';
  line_linked: 0 | 1;
};

export type ScanDecision = { claims: NewClaim[]; unlinked: number };

/**
 * 請求記録から台帳に足す行を決める。冪等(既に台帳にいる会員は足さない・同じ会員は最初の入会だけ)。
 * unlinked = 会員と紐付いていない該当請求の数(拾えないので数だけ返して見張る)。
 */
export function decideNewClaims(
  rows: BillingCandidate[],
  existingMemberIds: Set<number>,
  since: string = GIFT_START_DATE,
): ScanDecision {
  const sorted = [...rows].sort((a, b) => a.billing_date.localeCompare(b.billing_date) || a.billing_record_id - b.billing_record_id);
  const seen = new Set(existingMemberIds);
  const claims: NewClaim[] = [];
  let unlinked = 0;
  for (const r of sorted) {
    if (r.billing_date < since) continue;
    if (!isGiftEligibleProduct(r.product_name) || isCancelledBilling(r.status)) continue;
    if (r.boom_member_id == null) {
      unlinked += 1;
      continue;
    }
    if (seen.has(r.boom_member_id)) continue;
    seen.add(r.boom_member_id);
    claims.push({
      boom_member_id: r.boom_member_id,
      billing_record_id: r.billing_record_id,
      enrolled_on: r.billing_date,
      status: r.line_linked ? 'invite_pending' : 'no_line',
      line_linked: r.line_linked ? 1 : 0,
    });
  }
  return { claims, unlinked };
}

/** アンケートの回答(「キッズ130」「大人M」「ﾗｲﾄﾌﾞﾙｰ」など)を台帳の値にそろえる。読めなければ null */
export function normalizeSize(raw: string | null | undefined): GiftSize | null {
  const s = (raw ?? '').normalize('NFKC').toUpperCase().replace(/\s+/g, '').replace(/^(キッズ|KIDS|大人|ADULT)/, '').replace(/(CM|サイズ)$/, '');
  return (SIZES as readonly string[]).includes(s) ? (s as GiftSize) : null;
}

export function normalizeColor(raw: string | null | undefined): GiftColor | null {
  const s = (raw ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/グレイ$/, 'グレー');
  return (COLORS as readonly string[]).includes(s) ? (s as GiftColor) : null;
}

export function itemForSize(size: GiftSize): string {
  return (KIDS_SIZES as readonly string[]).includes(size) ? ITEM_KIDS : ITEM_ADULT;
}

export type OrderableClaim = { id: number; color: string | null; size: string | null };
export type OrderLine = { item: string; color: GiftColor; size: GiftSize; qty: number; claim_ids: number[] };
export type OrderSheet = { lines: OrderLine[]; total: number; unreadable: { id: number; color: string | null; size: string | null }[] };

/**
 * 回答済み・未発注の分を 品番×色×サイズ で数える(予備は足さない=在庫を作らない)。
 * 色かサイズが読めない回答は数えずに unreadable に出す(手で確かめる)。
 */
export function buildOrderSheet(claims: OrderableClaim[]): OrderSheet {
  const map = new Map<string, OrderLine>();
  const unreadable: OrderSheet['unreadable'] = [];
  for (const c of claims) {
    const color = normalizeColor(c.color);
    const size = normalizeSize(c.size);
    if (!color || !size) {
      unreadable.push({ id: c.id, color: c.color, size: c.size });
      continue;
    }
    const item = itemForSize(size);
    const key = `${item}|${color}|${size}`;
    const line = map.get(key) ?? { item, color, size, qty: 0, claim_ids: [] };
    line.qty += 1;
    line.claim_ids.push(c.id);
    map.set(key, line);
  }
  const lines = [...map.values()].sort(
    (a, b) =>
      a.item.localeCompare(b.item) ||
      COLORS.indexOf(a.color) - COLORS.indexOf(b.color) ||
      SIZES.indexOf(a.size) - SIZES.indexOf(b.size),
  );
  return { lines, total: lines.reduce((n, l) => n + l.qty, 0), unreadable };
}

/** 発注表(Markdown)。GitHub Actions のまとめ欄や秘書への申し送りに貼る。名前は入れない */
export function renderOrderSheetMarkdown(sheet: OrderSheet, today: string): string {
  const out = [`## 入会特典Tシャツ 発注表（${today}）`, ''];
  if (sheet.total === 0) {
    out.push('今週の発注は0枚です（回答済み・未発注の分がありません）。');
  } else {
    out.push(`合計 **${sheet.total}枚**（回答済み・未発注の分。予備は含めない）`, '');
    out.push('| 品番 | 色 | サイズ | 枚数 | 台帳ID |', '|---|---|---|---:|---|');
    for (const l of sheet.lines) {
      const size = (KIDS_SIZES as readonly string[]).includes(l.size) ? `キッズ${l.size}` : `大人${l.size}`;
      out.push(`| ${l.item} | ${l.color} | ${size} | ${l.qty} | ${l.claim_ids.join(', ')} |`);
    }
  }
  if (sheet.unreadable.length > 0) {
    out.push('', `⚠️ 色かサイズが読めない回答 ${sheet.unreadable.length}件（数えていません・台帳ID: ${sheet.unreadable.map((u) => u.id).join(', ')}）`);
  }
  return out.join('\n');
}
