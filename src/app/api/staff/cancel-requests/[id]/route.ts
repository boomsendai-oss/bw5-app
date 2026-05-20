import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/staff/cancel-requests/[id]
// body: { status: 'approved' | 'rejected', reviewer?: string, apply?: boolean }
//
// apply=true なら、承認時に該当lesson_instanceを自動cancel化 (instance_id ある場合)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  if (!['approved', 'rejected'].includes(body.status)) {
    return NextResponse.json({ error: 'status must be approved|rejected' }, { status: 400 });
  }

  const cr = await getOne(
    `SELECT cr.*, i.name AS instructor_name, i.contact_email AS instructor_email
     FROM lesson_cancel_requests cr
     LEFT JOIN instructors i ON i.id = cr.instructor_id
     WHERE cr.id = ?`,
    [numId]
  );
  if (!cr) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await execute(
    `UPDATE lesson_cancel_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [body.status, body.reviewer ?? 'staff', numId]
  );

  // 承認 + 該当instance_id ある場合は lesson_instance を cancelled に
  if (body.status === 'approved' && body.apply && cr.instance_id) {
    await execute(`UPDATE lesson_instances SET status = 'cancelled' WHERE id = ?`, [cr.instance_id]);
  }

  // インストラクターに通知メール
  try {
    const email = cr.instructor_email as string | null;
    if (email) {
      const subject = body.status === 'approved'
        ? '[BOOM] 休講申請が承認されました'
        : '[BOOM] 休講申請の確認';
      const text = body.status === 'approved'
        ? `${cr.instructor_name} 様\n\n${cr.lesson_date} の休講申請を承認しました。\n\nBOOM 代表 木村慎大郎(TARO)`
        : `${cr.instructor_name} 様\n\n${cr.lesson_date} の休講申請について、別途LINEでご連絡します。\n\nBOOM 代表 木村慎大郎(TARO)`;
      await sendEmail({ to: email, subject, text });
    }
  } catch {
    // 通知失敗は無視
  }

  return NextResponse.json({ ok: true });
}
