import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { randomBytes } from 'crypto';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/instructor/auth/reset-request
// body: { instructor_id }
// PINリセットメールを送信
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const instructorId = Number(body.instructor_id);
  if (!instructorId) return NextResponse.json({ error: 'instructor_id required' }, { status: 400 });

  const ins = await getOne(`SELECT id, name, contact_email FROM instructors WHERE id = ? AND active = 1`, [instructorId]);
  if (!ins) return NextResponse.json({ error: 'instructor not found' }, { status: 404 });
  const email = ins.contact_email as string | null;
  if (!email) return NextResponse.json({ error: 'メールアドレス未登録。TAROに連絡してください' }, { status: 400 });

  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await execute(
    `INSERT INTO instructor_pin_resets (instructor_id, reset_token, expires_at) VALUES (?, ?, ?)`,
    [Number(ins.id), token, expiresAt]
  );

  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const resetUrl = `${baseUrl}/instructor/reset?token=${token}`;

  try {
    await sendEmail({
      to: email,
      subject: '[BOOM] PINリセットのご案内',
      text: `${ins.name} 様\n\nPINリセットの申請を受け付けました。\n以下のURLから1時間以内に新しいPINを設定してください。\n\n${resetUrl}\n\n※ このメールに心当たりがない場合は破棄してください。\n\nBOOM 代表 木村慎大郎(TARO)`,
    });
  } catch (e) {
    return NextResponse.json({ error: 'メール送信失敗', detail: String(e) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, sent_to: email.replace(/(.{2}).+(@.+)/, '$1***$2') });
}
