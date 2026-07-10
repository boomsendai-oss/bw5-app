import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';
import { assessTicketWithdrawals } from '@/lib/membershipRules';
import { todayJst, isIsoDate } from '@/lib/dateJst';
import { badRequest } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/staff/members/withdrawal-export
 *   会員ルールv1: 承認した退会候補の「契約プラン」CSV(退会手続き日時入り)を書き出す。
 *   HACOMONO メンバー→インポート→「契約プラン」import に投入する形式。
 *   ★最終インポートは人手(不可逆・課金停止の顧客影響操作)。本APIは生成のみ。
 *
 *   body: { member_ids: number[], withdrawal_date?: 'YYYY-MM-DD' }
 *   返却: text/csv (UTF-8 BOM付き)
 *
 *   ★B-3(2026-07-06設計): member_ids は「今の退会候補」または「通知済み/退会記録済み
 *   (withdrawal_notices.status IN ('notified','withdrawn'))」と突合し、対象外IDが
 *   1件でも混ざっていれば 400 で全体拒否する(部分成功にしない)。
 *   これが無いと任意の会員ID(現役会員含む)を渡すだけで退会CSVに載ってしまう。
 *   ※ 'extended'(延長中)は保護対象なので許可しない。延長期限切れなら候補に自然復帰する。
 *   ※ family_review(現役家族リンクあり)も自動退会から除外のため許可しない。
 *      手動確認後に退会させる場合は、先に「通知済み」を記録してから書き出す運用。
 *
 *   注意: 契約番号がアプリDBに無いため、キーはメールアドレス/会員番号で出力する。
 *         HACOMONOの契約プランimportが契約番号キー固定の場合は、出力CSVの
 *         契約番号列を別途埋める必要がある(まずインポート検証で確認すること)。
 *         末尾列「氏名(参考)」と件数サマリ行はインポート前の目視照合用。
 *         HACOMONOに投入する際に列/行がエラーになる場合は削除して使う。
 */
const HEADER = [
  'メールアドレス',
  '会員番号',
  '契約番号',
  'プランコード',
  '終了日',
  '退会手続き日時',
  '氏名(参考)',
];

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.member_ids)
    ? body.member_ids.filter((x: unknown) => Number.isInteger(x))
    : [];
  if (ids.length === 0) {
    return badRequest('member_ids が空です');
  }
  // 退会日(終了日・退会手続き日時の基準)。未指定なら今日(JST)。
  // 指定があるのに不正形式(実在しない日付含む)なら黙ってフォールバックせず 400。
  if (body.withdrawal_date !== undefined && !isIsoDate(body.withdrawal_date)) {
    return badRequest('withdrawal_date は YYYY-MM-DD (実在する日付) で指定してください');
  }
  const dateStr: string = typeof body.withdrawal_date === 'string' ? body.withdrawal_date : todayJst();
  const procAt = `${dateStr} 00:00:00`;

  // ★B-3突合: 「現在の退会候補」∪「通知済み/退会記録済み」以外のIDは全体拒否
  const assessment = await assessTicketWithdrawals();
  const allowed = new Set<number>(assessment.candidates.map((c) => c.member_id));
  const noticed = (await getAll(
    `SELECT member_id FROM withdrawal_notices WHERE status IN ('notified','withdrawn')`
  )) as { member_id: number }[];
  for (const n of noticed) allowed.add(Number(n.member_id));

  const outsiders = ids.filter((id) => !allowed.has(id));
  if (outsiders.length > 0) {
    return NextResponse.json(
      {
        error:
          '退会候補・通知済みのいずれにも該当しない会員IDが含まれているため、CSV全体を拒否しました(部分出力はしません)',
        invalid_member_ids: outsiders,
      },
      { status: 400 }
    );
  }

  const placeholders = ids.map(() => '?').join(',');
  const rows = (await getAll(
    `SELECT email, hacomono_kaiin_no, plan_code, full_name
       FROM boom_members
      WHERE id IN (${placeholders})`,
    ids
  )) as { email: string | null; hacomono_kaiin_no: string | null; plan_code: string | null; full_name: string | null }[];

  const csvRows = rows.map((r) => [
    r.email ?? '',
    r.hacomono_kaiin_no ?? '',
    '', // 契約番号: DBに無いため空欄(必要ならHACOMONO契約プランCSVから照合)
    r.plan_code ?? '',
    dateStr, // 終了日
    procAt, // 退会手続き日時
    r.full_name ?? '', // 参考列: インポート前の人間の目視照合用
  ]);

  // 末尾サマリ行: 何件書き出したかの目視確認用(インポート時は削除する)
  const summaryRow = [`# 合計 ${csvRows.length}件`, '', '', '', '', '', ''];

  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [HEADER, ...csvRows, summaryRow].map((r) => r.map(esc).join(',')).join('\r\n');
  const filename = `契約プラン_退会_${dateStr}.csv`;

  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
