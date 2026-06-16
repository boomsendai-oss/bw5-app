import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/staff/members/withdrawal-export
 *   会員ルールv1: 承認した退会候補の「契約プラン」CSV(退会手続き日時入り)を書き出す。
 *   HACOMONO メンバー→インポート→「契約プラン」import に投入する形式。
 *   ★最終インポートは人手(不可逆・課金停止の顧客影響操作)。本APIは生成のみ。
 *
 *   body: { member_ids: number[], withdrawal_date?: 'YYYY-MM-DD' }
 *   返却: text/csv (UTF-8 BOM付き)
 *
 *   注意: 契約番号がアプリDBに無いため、キーはメールアドレス/会員番号で出力する。
 *         HACOMONOの契約プランimportが契約番号キー固定の場合は、出力CSVの
 *         契約番号列を別途埋める必要がある(まずインポート検証で確認すること)。
 */
const HEADER = [
  'メールアドレス',
  '会員番号',
  '契約番号',
  'プランコード',
  '終了日',
  '退会手続き日時',
];

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.member_ids)
    ? body.member_ids.filter((x: unknown) => Number.isInteger(x))
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'member_ids が空です' }, { status: 400 });
  }
  // 退会日(終了日・退会手続き日時の基準)。未指定なら今日
  const dateStr =
    typeof body.withdrawal_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.withdrawal_date)
      ? body.withdrawal_date
      : new Date().toISOString().slice(0, 10);
  const procAt = `${dateStr} 00:00:00`;

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
  ]);

  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [HEADER, ...csvRows].map((r) => r.map(esc).join(',')).join('\r\n');
  const filename = `契約プラン_退会_${dateStr}.csv`;

  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
