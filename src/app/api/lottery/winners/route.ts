import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// GET /api/lottery/winners — staff-facing winners list
// 当選者の実名(PII)を返すので認可必須。ip/fingerprint は運用に不要なので返さない。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    const winners = await getAll(
      "SELECT id, prize_name, prize_tier, winner_name, created_at FROM lottery_entries WHERE won = 1 ORDER BY created_at ASC"
    );
    const total = await getOne('SELECT COUNT(*) as c FROM lottery_entries');
    const totalEntries = Number(total?.c ?? 0);

    return NextResponse.json({
      winners_count: winners.length,
      total_entries: totalEntries,
      winners,
    });
  } catch (e) {
    console.error('lottery winners GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
