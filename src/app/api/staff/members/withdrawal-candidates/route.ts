import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { execute, getOne } from '@/lib/db';
import { assessTicketWithdrawals } from '@/lib/membershipRules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/staff/members/withdrawal-candidates
 *   会員ルールv1: チケット会員の「今月退会対象」と「1ヶ月前事前通知対象」を算出。
 *   ★読み取り専用。実際の退会はHACOMONOで人手処理する(不可逆操作)。
 *
 *   query (任意・後からTAROの判断でチューニング可能):
 *     normal_months   通常退会の閾値(月) default 6
 *     exception_months 入会未受講例外の閾値(月) default 3
 *     notice_days     事前通知ウィンドウ(日) default 30
 *
 * POST /api/staff/members/withdrawal-candidates
 *   進行状態の記録のみ (withdrawal_notices を upsert)。HACOMONOには一切書き込まない。
 *   body: { member_id, action: 'notified'|'extended'|'withdrawn'|'reset',
 *           channel?, extended_until?, reason?, last_checkin?, checkin_count?, note? }
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const num = (k: string, d: number) => {
    const v = Number(url.searchParams.get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };

  const assessment = await assessTicketWithdrawals({
    normalMonths: num('normal_months', 6),
    exceptionMonths: num('exception_months', 3),
    noticeWindowDays: num('notice_days', 30),
  });

  return NextResponse.json({
    ok: true,
    ...assessment,
    candidate_count: assessment.candidates.length,
    pre_notice_count: assessment.pre_notice.length,
    family_review_count: assessment.family_review.length,
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const memberId = Number(body.member_id);
  const action = String(body.action || '');
  if (!Number.isFinite(memberId) || memberId <= 0) {
    return NextResponse.json({ error: 'member_id required' }, { status: 400 });
  }
  const VALID = ['notified', 'extended', 'withdrawn', 'reset'];
  if (!VALID.includes(action)) {
    return NextResponse.json({ error: `action must be one of ${VALID.join('/')}` }, { status: 400 });
  }

  // 既存行があるか
  const existing = await getOne(`SELECT id FROM withdrawal_notices WHERE member_id = ?`, [memberId]);

  // action → 反映する列
  const now = new Date().toISOString();
  let status = 'candidate';
  let notifiedAt: string | null = null;
  let extendedUntil: string | null = null;
  let withdrawnAt: string | null = null;

  if (action === 'notified') {
    status = 'notified';
    notifiedAt = now;
  } else if (action === 'extended') {
    status = 'extended';
    extendedUntil = body.extended_until ? String(body.extended_until) : null;
    if (!extendedUntil) {
      return NextResponse.json({ error: 'extended_until required for extend' }, { status: 400 });
    }
  } else if (action === 'withdrawn') {
    // ★注意: これは「HACOMONOで退会処理をした」という人手記録にすぎない。
    //   アプリ側はHACOMONOに一切書き込まない。
    status = 'withdrawn';
    withdrawnAt = body.withdrawn_at ? String(body.withdrawn_at) : now.slice(0, 10);
  } else if (action === 'reset') {
    status = 'candidate';
  }

  if (existing) {
    await execute(
      `UPDATE withdrawal_notices SET
         status = ?,
         notified_at = COALESCE(?, notified_at),
         notice_channel = COALESCE(?, notice_channel),
         extended_until = CASE WHEN ? = 'reset' THEN NULL ELSE COALESCE(?, extended_until) END,
         withdrawn_at = COALESCE(?, withdrawn_at),
         note = COALESCE(?, note),
         updated_at = ?
       WHERE member_id = ?`,
      [status, notifiedAt, body.channel ?? null, action, extendedUntil, withdrawnAt, body.note ?? null, now, memberId]
    );
  } else {
    await execute(
      `INSERT INTO withdrawal_notices
         (member_id, reason, last_checkin_date, checkin_count, notified_at, notice_channel, extended_until, withdrawn_at, status, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        memberId,
        body.reason ?? 'inactive_6mo',
        body.last_checkin ?? null,
        Number(body.checkin_count ?? 0),
        notifiedAt,
        body.channel ?? null,
        extendedUntil,
        withdrawnAt,
        status,
        body.note ?? null,
        now,
        now,
      ]
    );
  }

  // お帰りクーポンの付与記録 (退会確定時のみ・記録のみ／HACOMONOクーポン作成はTARO手動)
  if (action === 'withdrawn') {
    const couponExists = await getOne(
      `SELECT id FROM homecoming_coupons WHERE member_id = ? AND trigger = 'auto_withdrawal'`,
      [memberId]
    );
    if (!couponExists) {
      await execute(
        `INSERT INTO homecoming_coupons (member_id, trigger, delivered_channel, issued_at)
         VALUES (?, 'auto_withdrawal', ?, ?)`,
        [memberId, body.channel ?? null, now]
      );
    }
  }

  return NextResponse.json({ ok: true, member_id: memberId, status });
}
