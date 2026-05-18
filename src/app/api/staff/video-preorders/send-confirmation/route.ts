import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { sendVideoPreorderMakeupEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5min (Vercel Pro想定だがFreeでも~60sは動く)

// POST /api/staff/video-preorders/send-confirmation
// body: { ids: number[] }   (送信対象の予約ID)
// 重複防止: confirmation_email_sent_at が既に入っているレコードはスキップ
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
  const force: boolean = !!body.force; // true なら送信済みでも再送

  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 });

  // 対象レコード取得
  const placeholders = ids.map(() => '?').join(',');
  const rows = await getAll(
    `SELECT vp.id, vp.buyer_name, vp.email, vp.phone, vp.status, vp.created_at, vp.confirmation_email_sent_at,
            m.name AS merch_name, m.price
     FROM video_preorders vp
     LEFT JOIN merchandise m ON m.id = vp.merch_id
     WHERE vp.id IN (${placeholders})`,
    ids,
  );

  type Row = {
    id: number;
    buyer_name: string;
    email: string | null;
    phone: string | null;
    status: string | null;
    created_at: string;
    confirmation_email_sent_at: string | null;
    merch_name: string | null;
    price: number | null;
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
    if (!force && r.confirmation_email_sent_at) {
      results.push({ id: r.id, status: 'skipped', reason: 'already sent' });
      continue;
    }

    try {
      // 予約日を「YYYY年M月D日 HH:MM」形式に整形
      const dt = new Date(r.created_at.replace(' ', 'T') + 'Z');
      const jstStr = dt.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      await sendVideoPreorderMakeupEmail({
        to: r.email,
        buyerName: r.buyer_name,
        preorderId: r.id,
        merchName: 'BOOM WOP vol.5 フルパフォーマンス映像',
        price: r.price ?? 3000,
        phone: r.phone ?? undefined,
        createdAt: jstStr,
      });

      const nowIso = new Date().toISOString();
      await execute('UPDATE video_preorders SET confirmation_email_sent_at = ? WHERE id = ?', [nowIso, r.id]);
      results.push({ id: r.id, status: 'sent' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: r.id, status: 'failed', reason: msg });
    }

    // Gmail SMTP レート対策: 1リクエスト辺り 500ms 間隔
    await new Promise(r => setTimeout(r, 500));
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;

  return NextResponse.json({ ok: true, sent, skipped, failed, results });
}
