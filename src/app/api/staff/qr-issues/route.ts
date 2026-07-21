// src/app/api/staff/qr-issues/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendEmail } from '@/lib/email';
import { resolveRecipient, maskEmail, buildQrEmail, qrFileName } from '@/lib/qrIssue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 固定QR発行台帳 (WS U / 2026-07-20、再送対応 2026-07-21)
 * GET  : 発行済み(=台帳に記録がある) hacomono_member_id の一覧+最終処理済みアンケート回答日時。
 *        GH Actionsスクリプトが差分計算(dedup)に使う
 * POST : multipart/form-data
 *   hacomono_member_id (必須)
 *   member_name        (メール宛名。DBには保存しない)
 *   email / rep_email  (ML001の本人・代表アドレス。DBには保存しない)
 *   last_answered_at   (任意。このリクエストの元になったアンケート回答のanswered_at。台帳に記録する)
 *   qr                 PNGファイル (宛先解決OKのとき必須)
 * 再送対応: 台帳に既存行があっても拒否しない(UPSERT)。アンケート再回答のたびに
 * 呼ばれる想定で、既存の固定コードのQRをそのまま再送する(新規コードは作らない=issue_qr.mjs側の責務)。
 */

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = (await getAll(
    `SELECT hacomono_member_id, status, last_answered_at FROM member_qr_issues`
  )) as { hacomono_member_id: string; status: string; last_answered_at: string | null }[];
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
  const lastAnsweredAt = String(form.get('last_answered_at') ?? '').trim() || null;
  if (!memberId) {
    return NextResponse.json({ error: 'hacomono_member_id は必須です' }, { status: 400 });
  }

  const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const recipient = resolveRecipient(email, repEmail);
  if (!recipient.ok) {
    await execute(
      `INSERT INTO member_qr_issues (hacomono_member_id, status, issued_at, detail, last_answered_at)
       VALUES (?, 'manual_needed', ?, ?, ?)
       ON CONFLICT(hacomono_member_id) DO UPDATE SET
         status = excluded.status, detail = excluded.detail, last_answered_at = excluded.last_answered_at`,
      [memberId, nowIso, `宛先解決不可: ${recipient.reason}`, lastAnsweredAt]
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

  const resolvedName = memberName || 'メンバー';
  const mail = buildQrEmail(resolvedName);
  await sendEmail({
    to: recipient.to,
    subject: mail.subject,
    text: mail.text,
    attachments: [{ filename: qrFileName(resolvedName), content: png }],
  });

  // issued_atは初回のみ入れたい(=いつ最初にコードが発行されたか)ので、
  // DO UPDATEでは触らずINSERT時の値(nowIso)を残す。再送の度に上書きしない。
  await execute(
    `INSERT INTO member_qr_issues (hacomono_member_id, status, email_to_masked, issued_at, emailed_at, last_answered_at)
     VALUES (?, 'emailed', ?, ?, ?, ?)
     ON CONFLICT(hacomono_member_id) DO UPDATE SET
       status = excluded.status, email_to_masked = excluded.email_to_masked,
       emailed_at = excluded.emailed_at, last_answered_at = excluded.last_answered_at`,
    [memberId, maskEmail(recipient.to), nowIso, nowIso, lastAnsweredAt]
  );
  return NextResponse.json({ ok: true, status: 'emailed', to_masked: maskEmail(recipient.to) });
}
