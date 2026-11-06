// HIRO ワークショップの銀行振込を、GMOあおぞらの入出金明細と照合する。
// 呼ぶのは scripts/bf7_ws_match_transfers.mjs(明細CSVを読んで入金の行だけ送る)。
// apply=false は照合結果を返すだけ。apply=true のときだけ「受付番号と金額が合う振込待ち」を入金済みにし、確定メールを送る。
// 返すのは受付番号・日付・金額・理由だけ(名前・連絡先は返さない)。
// ⚠️ proxy は cookie の有無しか見ないため、withAuth でセッションを本検証する(規約4.5)。
import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { listBf7WsTransferOrders, setBf7WsTransferReceived } from '@/lib/bf7WorkshopDb';
import { sendBf7WsPaidMail } from '@/lib/bf7WorkshopPaidMail';
import { matchBf7WsTransfers, type BankDeposit } from '@/lib/bf7WsTransferMatch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function toDeposits(v: unknown): BankDeposit[] | null {
  if (!Array.isArray(v) || v.length > 5000) return null;
  const out: BankDeposit[] = [];
  for (const d of v) {
    if (!d || typeof d !== 'object') return null;
    const { date, description, amount } = d as Record<string, unknown>;
    if (typeof date !== 'string' || typeof description !== 'string' || typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    out.push({ date: date.slice(0, 40), description: description.slice(0, 200), amount: Math.round(amount) });
  }
  return out;
}

export const POST = withAuth(async (req) => {
  const body = (await req.json().catch(() => null)) as { deposits?: unknown; apply?: unknown } | null;
  const deposits = toDeposits(body?.deposits);
  if (!deposits) return NextResponse.json({ error: 'deposits が不正です' }, { status: 400 });
  const apply = body?.apply === true;

  const matches = matchBf7WsTransfers(deposits, await listBf7WsTransferOrders());
  const results = [];
  for (const m of matches) {
    const base = { kind: m.kind, orderId: m.orderId, date: m.deposit.date, amount: m.deposit.amount, reason: m.kind === 'review' ? m.reason : '' };
    if (m.kind === 'auto' && apply) {
      const updated = await setBf7WsTransferReceived(m.orderId, true);
      const mailed = updated ? await sendBf7WsPaidMail(m.orderId) : false;
      results.push({ ...base, applied: updated, mailed });
    } else {
      results.push({ ...base, applied: false, mailed: false });
    }
  }
  return NextResponse.json({ apply, results }, { headers: { 'Cache-Control': 'no-store' } });
});
