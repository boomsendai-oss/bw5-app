// src/app/api/staff/qr-issues/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendEmail } from '@/lib/email';
import { resolveRecipient, maskEmail, buildQrEmail } from '@/lib/qrIssue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 固定QR発行台帳 (WS U / 2026-07-20)
 * GET  : 発行済み(=台帳に記録がある) hacomono_member_id の一覧。GH Actionsスクリプトが差分計算に使う
 * POST : multipart/form-data
 *   hacomono_member_id (必須)
 *   member_name        (メール宛名。DBには保存しない)
 *   email / rep_email  (ML001の本人・代表アドレス。DBには保存しない)
 *   action             'send'(QR添付送信) | 'skipped_existing'(手動発行済みの記録のみ)
 *   qr                 PNGファイル (action=send のとき必須)
 * 冪等: 同じ member_id は2回目以降 {already:true} で何もしない
 */

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = (await getAll(
    `SELECT hacomono_member_id, status FROM member_qr_issues`
  )) as { hacomono_member_id: string; status: string }[];
  return NextResponse.json({ issued: rows });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    return await handle(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `qr-issues: ${msg}` }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const form = await req.formData();
  const memberId = String(form.get('hacomono_member_id') ?? '').trim();
  const memberName = String(form.get('member_name') ?? '').trim();
  const email = String(form.get('email') ?? '');
  const repEmail = String(form.get('rep_email') ?? '');
  const action = String(form.get('action') ?? 'send');
  if (!memberId) {
    return NextResponse.json({ error: 'hacomono_member_id は必須です' }, { status: 400 });
  }

  const existing = await getOne(
    `SELECT id, status FROM member_qr_issues WHERE hacomono_member_id = ?`, [memberId]
  );
  if (existing) return NextResponse.json({ ok: true, already: true, status: existing.status });

  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (action === 'skipped_existing') {
    await execute(
      `INSERT INTO member_qr_issues (hacomono_member_id, status, issued_at, detail)
       VALUES (?, 'skipped_existing', ?, 'HACOMONO側に既存の固定コードあり(手動発行済み)')`,
      [memberId, nowIso]
    );
    return NextResponse.json({ ok: true, status: 'skipped_existing' });
  }

  // action === 'send'
  const recipient = resolveRecipient(email, repEmail);
  if (!recipient.ok) {
    await execute(
      `INSERT INTO member_qr_issues (hacomono_member_id, status, issued_at, detail)
       VALUES (?, 'manual_needed', ?, ?)`,
      [memberId, nowIso, `宛先解決不可: ${recipient.reason}`]
    );
    await execute(
      `INSERT INTO staff_notifications (type, title, detail, severity)
       VALUES ('qr_issue_manual', '固定QR: 手動送付が必要', ?, 'warning')`,
      [`hacomono_member_id=${memberId} 宛先解決不可(${recipient.reason})。HACOMONO管理画面から手動で送付してください`]
    );
    return NextResponse.json({ ok: true, status: 'manual_needed', reason: recipient.reason });
  }

  const qr = form.get('qr') as File | null;
  if (!qr) return NextResponse.json({ error: 'qr ファイルが必要です' }, { status: 400 });
  const png = Buffer.from(await qr.arrayBuffer());

  const mail = buildQrEmail(memberName || 'メンバー');
  await sendEmail({
    to: recipient.to,
    subject: mail.subject,
    text: mail.text,
    attachments: [{ filename: 'boom_checkin_qr.png', content: png }],
  });

  await execute(
    `INSERT INTO member_qr_issues (hacomono_member_id, status, email_to_masked, issued_at, emailed_at)
     VALUES (?, 'emailed', ?, ?, ?)`,
    [memberId, maskEmail(recipient.to), nowIso, nowIso]
  );
  return NextResponse.json({ ok: true, status: 'emailed', to_masked: maskEmail(recipient.to) });
}
