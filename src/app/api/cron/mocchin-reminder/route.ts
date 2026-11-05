import { NextRequest, NextResponse } from 'next/server';
import { todayJst } from '@/lib/dateJst';
import { sendEmail } from '@/lib/email';
import { buildMocchinReminderEmail, mocchinRemindSteps } from '@/lib/mocchinEntry';
import { listMocchinEntries, markMocchinReminded } from '@/lib/mocchinEntryDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/mocchin-reminder
// Vercel Cron から毎朝(JST 9時)呼ばれ、MOCCHINナンバーの支払い期限が3日以内で未入金の方へお知らせメールを送る。
// 同じ回には1度だけ(reminded列に記録)。取消の申込とプレビューからのテスト申込には送らない。
// 認証は他cronと同じ CRON_SECRET(Vercelが Authorization: Bearer で送る)。
export async function GET(req: NextRequest) {
  // フェイルクローズ: CRON_SECRET未設定なら実行拒否、Bearer不一致は401。
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const today = todayJst();
  let sent = 0;
  let failed = 0;
  for (const e of await listMocchinEntries()) {
    if (e.status !== 'active' || e.staffNote.includes('テスト')) continue;
    const steps = mocchinRemindSteps(e, today);
    if (steps.length === 0) continue;
    try {
      const mail = buildMocchinReminderEmail({ id: e.id, name: e.name, steps });
      await sendEmail({ to: e.email, subject: mail.subject, text: mail.text });
      await markMocchinReminded(e.id, e.reminded, steps.map((s) => s.step));
      sent++;
    } catch (err) {
      console.error('[mocchin-reminder] failed', e.id, err instanceof Error ? err.message : err);
      failed++;
    }
  }
  return NextResponse.json({ ok: true, today, sent, failed });
}
