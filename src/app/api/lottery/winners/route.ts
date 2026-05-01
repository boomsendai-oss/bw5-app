import { NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/lottery/winners — staff-facing winners list
export async function GET() {
  try {
    const winners = await getAll(
      "SELECT id, fingerprint, ip, prize_name, winner_name, created_at FROM lottery_entries WHERE won = 1 ORDER BY created_at ASC"
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
