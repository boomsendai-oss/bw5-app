import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute } from '@/lib/db';
import { todayJst, nowUtcIso } from '@/lib/dateJst';
import { notifyTaro } from '@/lib/notify';
import { pickDue, formatReminderBody, type ReminderRow } from '@/lib/reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/cron/reminders
// staff_reminders のうち期日が来ていて未送信のものをTAROへ通知し、送信済みにする。
//
// 「N日後にこれをやる」をSTATE.mdや記憶に預けないための仕組み。
// 期日を過ぎたものも未送信なら拾う(cronが落ちた日があっても取りこぼさない)。
// 送信後に sent_at を入れるので二重送信しない。毎朝叩いてよい。
//
// 認証: 他のcronと同じ CRON_SECRET。
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const today = todayJst();
  const rows = (await getAll(
    `SELECT id, due_date, title, body, sent_at FROM staff_reminders WHERE sent_at IS NULL`
  )) as ReminderRow[];

  const due = pickDue(rows, today);
  if (due.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, note: '期日が来ているリマインダーはありません' });
  }

  const sent: string[] = [];
  const failed: string[] = [];
  for (const r of due) {
    try {
      await notifyTaro({
        subjectPrefix: '[BOOM リマインダー]',
        subject: r.title,
        body: formatReminderBody(r, today),
      });
      // 送信できたものだけ送信済みにする。ここで失敗したら翌朝また拾われる
      await execute(`UPDATE staff_reminders SET sent_at=? WHERE id=?`, [nowUtcIso(), r.id]);
      sent.push(r.title);
    } catch (e) {
      failed.push(`${r.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: failed.length === 0, sent: sent.length, titles: sent, failed });
}
