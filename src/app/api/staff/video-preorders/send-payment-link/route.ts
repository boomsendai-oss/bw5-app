import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendVideoPreorderPaymentLinkEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 固定値 (将来 settings table に移行検討)
const SQUARE_PAYMENT_URL = 'https://square.link/u/nlufWFtA';
const DEFAULT_DEADLINE = '2026年5月27日(火) 23:59';

// POST /api/staff/video-preorders/send-payment-link
// body: { ids: number[], deadline?: string, force?: boolean }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
  const deadline: string = body.deadline ?? DEFAULT_DEADLINE;
  const force: boolean = !!body.force;
  const paymentUrl: string = body.paymentUrl ?? SQUARE_PAYMENT_URL;

  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  const placeholders = ids.map(() => '?').join(',');
  const rows = await getAll(
    `SELECT id, buyer_name, email, phone, status, payment_link_sent_at, payment_paid_at
     FROM video_preorders WHERE id IN (${placeholders})`,
    ids,
  );

  type Row = {
    id: number;
    buyer_name: string;
    email: string | null;
    phone: string | null;
    status: string | null;
    payment_link_sent_at: string | null;
    payment_paid_at: string | null;
  };

  const results: { id: number; status: 'sent' | 'skipped' | 'failed'; reason?: string }[] = [];

  for (const r of rows as Row[]) {
    if (!r.email) {
      results.push({ id: r.id, status: 'skipped', reason: 'no email' });
      continue;
    }
    if (r.status === 'duplicate' || r.status === 'cancelled') {
      results.push({ id: r.id, status: 'skipped', reason: `status=${r.status}` });
      continue;
    }
    if (r.payment_paid_at) {
      results.push({ id: r.id, status: 'skipped', reason: 'already paid' });
      continue;
    }
    if (!force && r.payment_link_sent_at) {
      results.push({ id: r.id, status: 'skipped', reason: 'already sent' });
      continue;
    }

    try {
      await sendVideoPreorderPaymentLinkEmail({
        to: r.email,
        buyerName: r.buyer_name,
        preorderId: r.id,
        paymentUrl,
        deadlineLabel: deadline,
      });

      const nowIso = new Date().toISOString();
      await execute(
        'UPDATE video_preorders SET payment_link_sent_at = ? WHERE id = ?',
        [nowIso, r.id]
      );
      results.push({ id: r.id, status: 'sent' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: r.id, status: 'failed', reason: msg });
    }

    await new Promise(r => setTimeout(r, 500));
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;

  return NextResponse.json({ ok: true, sent, skipped, failed, results });
}
