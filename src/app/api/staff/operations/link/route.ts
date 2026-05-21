import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/operations/link
// body: { member_id: number, lstep_id: string, relation: '本人'|'保護者'|'講師', confidence?: '確実'|'推定' }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  let body: {
    member_id?: unknown;
    lstep_id?: unknown;
    relation?: unknown;
    confidence?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON が不正です' }, { status: 400 });
  }

  const memberId = typeof body.member_id === 'number' ? body.member_id : Number(body.member_id);
  const lstepId = typeof body.lstep_id === 'string' ? body.lstep_id.trim() : '';
  const relation = typeof body.relation === 'string' ? body.relation : '';
  const confidence = typeof body.confidence === 'string' ? body.confidence : '推定';

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return NextResponse.json({ error: 'member_id が不正です' }, { status: 400 });
  }
  if (!lstepId) {
    return NextResponse.json({ error: 'lstep_id が必要です' }, { status: 400 });
  }
  if (!['本人', '保護者', '講師'].includes(relation)) {
    return NextResponse.json({ error: 'relation は 本人/保護者/講師 のいずれか' }, { status: 400 });
  }
  if (!['確実', '推定'].includes(confidence)) {
    return NextResponse.json({ error: 'confidence は 確実/推定 のいずれか' }, { status: 400 });
  }

  try {
    await execute(
      `INSERT INTO member_lstep_links (member_id, lstep_id, relation, confidence, confirmed_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(member_id, lstep_id) DO UPDATE SET
         relation = excluded.relation,
         confidence = excluded.confidence,
         confirmed_at = CURRENT_TIMESTAMP`,
      [memberId, lstepId, relation, confidence]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `紐付け保存失敗: ${msg}` }, { status: 500 });
  }
}
