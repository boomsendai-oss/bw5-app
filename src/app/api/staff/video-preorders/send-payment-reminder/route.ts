import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendVideoPreorderPaymentReminderEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Square 決済リンク (住所入力不要のカテゴリで作成された新URL)
const SQUARE_PAYMENT_URL = 'https://square.link/u/QgqAM1c2';
const DEFAULT_DEADLINE_ISO = '2026-05-27T23:59:00+09:00'; // 締切
const DEFAULT_DEADLINE_LABEL = '2026年5月27日(火) 23:59';

// POST /api/staff/video-preorders/send-payment-reminder
// body: { mode?: 'auto' | 'manual', ids?: number[], paymentUrl?: string, deadlineIso?: string, deadlineLabel?: string }
//
// mode='auto': 期限から3日前 or 0日前(=本日)の場合のみ送信。それ以外は何もしない。
//              未払い者全員(payment_link_sent_at IS NOT NULL AND payment_paid_at IS NULL)が対象。
// mode='manual': 指定された ids に対して送信。
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const mode: 'auto' | 'manual' = body.mode === 'manual' ? 'manual' : 'auto';
  const paymentUrl: string = body.paymentUrl ?? SQUARE_PAYMENT_URL;
  const deadlineIso: string = body.deadlineIso ?? DEFAULT_DEADLINE_ISO;
  const deadlineLabel: string = body.deadlineLabel ?? DEFAULT_DEADLINE_LABEL;

  const deadlineDate = new Date(deadlineIso);
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.ceil((deadlineDate.getTime() - now.getTime()) / msPerDay);

  // auto モードは「3日前」or「当日」のみ実行
  if (mode === 'auto' && daysRemaining !== 3 && daysRemaining !== 0) {
    return NextResponse.json({
      ok: true,
      skipped: 'not reminder day',
      daysRemaining,
      message: `今日は期限まで${daysRemaining}日。リマインダー送信日(3日前/当日)ではありません。`,
    });
  }

  // 対象選定
  let rows: { id: number; buyer_name: string; email: string | null }[];
  if (mode === 'manual' && Array.isArray(body.ids)) {
    const ids = body.ids.map(Number).filter(Number.isFinite);
    if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });
    const placeholders = ids.map(() => '?').join(',');
    rows = await getAll(
      `SELECT id, buyer_name, email FROM video_preorders
       WHERE id IN (${placeholders})
         AND (status IS NULL OR status NOT IN ('duplicate','cancelled'))
         AND email IS NOT NULL AND email != ''
         AND payment_paid_at IS NULL`,
      ids,
    ) as { id: number; buyer_name: string; email: string | null }[];
  } else {
    rows = await getAll(
      `SELECT id, buyer_name, email FROM video_preorders
       WHERE payment_link_sent_at IS NOT NULL
         AND payment_paid_at IS NULL
         AND (status IS NULL OR status NOT IN ('duplicate','cancelled'))
         AND email IS NOT NULL AND email != ''`,
    ) as { id: number; buyer_name: string; email: string | null }[];
  }

  const results: { id: number; status: 'sent' | 'failed'; reason?: string }[] = [];
  for (const r of rows) {
    if (!r.email) continue;
    try {
      await sendVideoPreorderPaymentReminderEmail({
        to: r.email,
        buyerName: r.buyer_name,
        preorderId: r.id,
        paymentUrl,
        deadlineLabel,
        daysRemaining: Math.max(0, daysRemaining),
      });
      results.push({ id: r.id, status: 'sent' });
      // リマインダー送信日時を notes 等に記録 (将来 reminder_sent_at カラム追加検討)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: r.id, status: 'failed', reason: msg });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;
  return NextResponse.json({ ok: true, mode, daysRemaining, sent, failed, results });
}
