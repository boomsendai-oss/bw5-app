import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { getInstructorBySession } from '@/lib/instructorAuth';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET: 自分の休講申請一覧
export async function GET(req: NextRequest) {
  const me = await getInstructorBySession(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const items = await getAll(
    `SELECT * FROM lesson_cancel_requests WHERE instructor_id = ? ORDER BY lesson_date DESC LIMIT 50`,
    [me.id]
  );
  return NextResponse.json({ items });
}

// POST: 休講申請を作成
// body: { lesson_date, master_id?, instance_id?, reason, substitute_instructor_id? }
export async function POST(req: NextRequest) {
  const me = await getInstructorBySession(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.lesson_date) return NextResponse.json({ error: 'lesson_date required' }, { status: 400 });
  if (!body.reason) return NextResponse.json({ error: 'reason required' }, { status: 400 });

  const result = await execute(
    `INSERT INTO lesson_cancel_requests (instructor_id, lesson_date, master_id, instance_id, reason, substitute_instructor_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [me.id, body.lesson_date, body.master_id ?? null, body.instance_id ?? null, body.reason, body.substitute_instructor_id ?? null]
  );

  // TAROへ通知メール
  try {
    await sendEmail({
      to: 'boom.sendai@gmail.com',
      subject: `[BOOM] ${me.name} さんから休講申請`,
      text: `${me.name} さんから休講申請がありました。\n\nレッスン日: ${body.lesson_date}\n理由: ${body.reason}\n代講: ${body.substitute_instructor_id ? 'あり (ID: ' + body.substitute_instructor_id + ')' : 'なし'}\n\nBW5アプリで承認/却下してください: /staff (Phase 2 で承認UI実装予定)`,
    });
  } catch {
    // メール失敗してもDB登録は完了済み
  }

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
