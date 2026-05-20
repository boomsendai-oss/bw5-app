import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/kpi/clear-bank
// body: { confirmed_only?: boolean, before_date?: 'YYYY-MM-DD' }
// 未確定の bank_transactions をクリア (再取込用)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  // デフォルトは未確定のみ削除 (confirmed=0)
  const sql = body.all === true
    ? `DELETE FROM bank_transactions`
    : `DELETE FROM bank_transactions WHERE confirmed = 0`;
  const r = await execute(sql);
  return NextResponse.json({ ok: true, deleted: r.rowsAffected });
}
