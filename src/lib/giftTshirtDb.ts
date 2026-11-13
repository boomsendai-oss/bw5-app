// 入会特典Tシャツの DB層(2026-11-13)。判定・集計は giftTshirt.ts(純粋関数)。
// ⚠️ 名前・電話・メールは読まない・返さない(公開リポジトリ・Vercelログ)。返すのは内部IDと数だけ。
// ⚠️ ここではお客さんへの送信(LINE)・Amazonでの購入はしない。台帳を書くのは「該当者の追加」だけ。
import { getAll, execute } from './db';
import { todayJst } from './dateJst';
import { GIFT_START_DATE, decideNewClaims, buildOrderSheet, renderOrderSheetMarkdown, type BillingCandidate, type OrderSheet } from './giftTshirt';

/** 台帳テーブルが本番にまだ無い(マイグレーション未適用)ときのエラーか */
export function isMissingTableError(e: unknown): boolean {
  return /no such table:?\s*gift_tshirt_claims/i.test(e instanceof Error ? e.message : String(e));
}

export type ScanSummary = { ok: true; since: string; candidates: number; added: number; invite_pending: number; no_line: number; unlinked: number };

/** 11/1以降に特典つきで月謝プラン入会した会員を台帳に「未案内」(LINEなしは no_line)で足す。冪等。 */
export async function runGiftTshirtScan(since: string = GIFT_START_DATE): Promise<ScanSummary> {
  // 文字列の条件は SQL でも粗く絞る(全件を読まないため)。最終判定は decideNewClaims。
  const rows = (await getAll(
    `SELECT b.id AS billing_record_id, b.billing_date, b.boom_member_id, b.product_name, b.status,
            EXISTS (SELECT 1 FROM member_lstep_links l WHERE l.member_id = b.boom_member_id) AS line_linked
       FROM hacomono_billing_records b
      WHERE b.billing_date >= ?
        AND b.product_name LIKE '%入会金x1%'
        AND b.product_name LIKE '%クーポン割引 (入会金)%'`,
    [since],
  )) as (Omit<BillingCandidate, 'line_linked'> & { line_linked: number })[];
  const existing = (await getAll(`SELECT boom_member_id FROM gift_tshirt_claims`)) as { boom_member_id: number }[];
  const { claims, unlinked } = decideNewClaims(
    rows.map((r) => ({ ...r, line_linked: Number(r.line_linked) === 1 })),
    new Set(existing.map((e) => Number(e.boom_member_id))),
    since,
  );
  const summary: ScanSummary = { ok: true, since, candidates: rows.length, added: 0, invite_pending: 0, no_line: 0, unlinked };
  for (const c of claims) {
    const res = await execute(
      `INSERT OR IGNORE INTO gift_tshirt_claims (boom_member_id, billing_record_id, enrolled_on, status, line_linked)
       VALUES (?, ?, ?, ?, ?)`,
      [c.boom_member_id, c.billing_record_id, c.enrolled_on, c.status, c.line_linked],
    );
    if (!res || (res.rowsAffected ?? 0) === 0) continue;
    summary.added += 1;
    if (c.status === 'invite_pending') summary.invite_pending += 1;
    else summary.no_line += 1;
  }
  return summary;
}

export type OrderSheetResult = { ok: true; date: string; sheet: OrderSheet; markdown: string };

/** 回答済み・未発注の分の発注表(読み取りのみ。台帳は書き換えない=「発注済み」は買った後に別途) */
export async function getGiftTshirtOrderSheet(): Promise<OrderSheetResult> {
  const claims = (await getAll(
    `SELECT id, color, size FROM gift_tshirt_claims
      WHERE status = 'answered' AND ordered_on IS NULL
      ORDER BY id`,
  )) as { id: number; color: string | null; size: string | null }[];
  const sheet = buildOrderSheet(claims.map((c) => ({ ...c, id: Number(c.id) })));
  const date = todayJst();
  return { ok: true, date, sheet, markdown: renderOrderSheetMarkdown(sheet, date) };
}
