import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  if (!ym) {
    const months = await getAll(
      `SELECT year_month, COUNT(*) AS studios, SUM(total_amount) AS total
       FROM studio_billing_runs GROUP BY year_month ORDER BY year_month DESC LIMIT 12`
    );
    return NextResponse.json({ months });
  }
  const runs = await getAll(
    `SELECT sbr.*, s.name AS studio_name, s.pricing_model, s.payment_type
     FROM studio_billing_runs sbr LEFT JOIN studios s ON s.id = sbr.studio_id
     WHERE sbr.year_month = ? ORDER BY s.name`,
    [ym]
  );
  return NextResponse.json({ year_month: ym, runs });
}
